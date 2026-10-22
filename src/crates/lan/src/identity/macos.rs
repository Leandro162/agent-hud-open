//! Keychain-held signing key and certificate for the LAN TLS identity.
use super::*;
use core_foundation::{
    base::{CFType, TCFType},
    boolean::CFBoolean,
    data::CFData,
    dictionary::CFDictionary,
    number::CFNumber,
    string::{CFString, CFStringRef},
};
use security_framework::{
    certificate::SecCertificate,
    key::{Algorithm, SecKey},
    policy::SecPolicy,
    secure_transport::SslProtocolSide,
    trust::SecTrust,
};
use security_framework_sys::{item::*, keychain_item::SecItemCopyMatching};
extern "C" {
    static kSecAttrApplicationTag: CFStringRef;
    static kSecPrivateKeyAttrs: CFStringRef;
}
fn key(value: CFStringRef) -> CFType {
    unsafe { CFString::wrap_under_get_rule(value) }.as_CFType()
}
pub fn load(device: &str, directory: &Path) -> Result<Identity> {
    if !directory.is_absolute() || uuid::Uuid::parse_str(device).is_err() {
        return Err("Explicit LAN identity path and installation UUID required".into());
    }
    let tag = CFData::from_buffer(format!("app.agenthud.local-network.{device}").as_bytes());
    let secret = unsafe {
        let query = CFDictionary::from_CFType_pairs(&[
            (key(kSecClass), key(kSecClassKey)),
            (key(kSecAttrApplicationTag), tag.as_CFType()),
            (key(kSecAttrKeyType), key(kSecAttrKeyTypeECSECPrimeRandom)),
            (key(kSecReturnRef), CFBoolean::true_value().as_CFType()),
        ]);
        let mut found = std::ptr::null();
        let status = SecItemCopyMatching(query.as_concrete_TypeRef(), &mut found);
        if status == 0 && !found.is_null() {
            SecKey::wrap_under_create_rule(found as _)
        } else if status == -25300 {
            let private = CFDictionary::from_CFType_pairs(&[
                (
                    key(kSecAttrIsPermanent),
                    CFBoolean::true_value().as_CFType(),
                ),
                (key(kSecAttrApplicationTag), tag.as_CFType()),
                (
                    key(kSecAttrLabel),
                    CFString::new("Agent HUD local connection").as_CFType(),
                ),
            ]);
            let attrs = CFDictionary::from_CFType_pairs(&[
                (key(kSecAttrKeyType), key(kSecAttrKeyTypeECSECPrimeRandom)),
                (
                    key(kSecAttrKeySizeInBits),
                    CFNumber::from(256_i32).as_CFType(),
                ),
                (key(kSecPrivateKeyAttrs), private.as_CFType()),
            ]);
            #[allow(deprecated)]
            SecKey::generate(attrs.to_untyped()).map_err(|_| "Cannot create persistent LAN key")?
        } else {
            return Err("Cannot read persistent LAN key".into());
        }
    };
    let public = secret
        .public_key()
        .and_then(|key| key.external_representation())
        .ok_or("LAN public key unavailable")?;
    let certificate_file = directory.join("certificate.der");
    let stored = std::fs::read(&certificate_file)
        .ok()
        .filter(|bytes| current(bytes, public.bytes(), device));
    let certificate = match stored {
        Some(bytes) => bytes,
        None => {
            let certificate = certificate(&secret, public.bytes(), device)?;
            crate::fs::private_dir(directory).map_err(|e| e.to_string())?;
            let temp = directory.join(format!(".certificate-{}", uuid::Uuid::new_v4()));
            std::fs::write(&temp, &certificate).map_err(|_| "LAN certificate write")?;
            std::fs::rename(temp, certificate_file).map_err(|_| "LAN certificate commit")?;
            certificate
        }
    };
    Identity::from_signer(certificate, Arc::new(KeySigner(secret)))
}
fn current(bytes: &[u8], public: &[u8], device: &str) -> bool {
    let Ok(certificate) = SecCertificate::from_der(bytes) else {
        return false;
    };
    let policy = SecPolicy::create_ssl(
        SslProtocolSide::SERVER,
        Some(&format!("agenthud-{device}.local")),
    );
    let Ok(mut trust) =
        SecTrust::create_with_certificates(std::slice::from_ref(&certificate), &[policy])
    else {
        return false;
    };
    if trust.set_anchor_certificates(&[certificate]).is_err()
        || trust.set_trust_anchor_certificates_only(true).is_err()
        || trust.set_network_fetch_allowed(false).is_err()
        || trust.evaluate_with_error().is_err()
    {
        return false;
    }
    trust
        .copy_public_key()
        .ok()
        .and_then(|key| key.external_representation())
        .is_some_and(|value| value.bytes() == public)
}
#[derive(Debug)]
struct KeySigner(SecKey);
impl rustls::sign::SigningKey for KeySigner {
    fn choose_scheme(
        &self,
        offered: &[rustls::SignatureScheme],
    ) -> Option<Box<dyn rustls::sign::Signer>> {
        offered
            .contains(&rustls::SignatureScheme::ECDSA_NISTP256_SHA256)
            .then(|| Box::new(KeySigner(self.0.clone())) as Box<dyn rustls::sign::Signer>)
    }
    fn algorithm(&self) -> rustls::SignatureAlgorithm {
        rustls::SignatureAlgorithm::ECDSA
    }
}
impl rustls::sign::Signer for KeySigner {
    fn sign(&self, message: &[u8]) -> std::result::Result<Vec<u8>, rustls::Error> {
        self.0
            .create_signature(Algorithm::ECDSASignatureMessageX962SHA256, message)
            .map_err(|_| rustls::Error::General("Keychain LAN signature failed".into()))
    }
    fn scheme(&self) -> rustls::SignatureScheme {
        rustls::SignatureScheme::ECDSA_NISTP256_SHA256
    }
}
fn certificate(key: &SecKey, public: &[u8], device: &str) -> Result<Vec<u8>> {
    let algorithm = seq(oid(&[1, 2, 840, 10045, 4, 3, 2]));
    let name = seq(der(
        0x31,
        seq([
            oid(&[2, 5, 4, 3]),
            der(0x0c, format!("Agent HUD {device}").into_bytes()),
        ]
        .concat()),
    ));
    let now = chrono::Utc::now();
    let validity = seq([
        der(
            0x18,
            (now - chrono::Duration::days(1))
                .format("%Y%m%d%H%M%SZ")
                .to_string()
                .into_bytes(),
        ),
        der(
            0x18,
            (now + chrono::Duration::days(365))
                .format("%Y%m%d%H%M%SZ")
                .to_string()
                .into_bytes(),
        ),
    ]
    .concat());
    let public_info = seq([
        seq([
            oid(&[1, 2, 840, 10045, 2, 1]),
            oid(&[1, 2, 840, 10045, 3, 1, 7]),
        ]
        .concat()),
        der(0x03, [vec![0], public.into()].concat()),
    ]
    .concat());
    let mut serial = vec![0u8; 16];
    rustls::crypto::ring::default_provider()
        .secure_random
        .fill(&mut serial)
        .map_err(|_| "LAN serial entropy")?;
    serial[0] = (serial[0] & 0x7f) | 1;
    let constraints = seq([
        oid(&[2, 5, 29, 19]),
        der(0x01, vec![0xff]),
        der(0x04, seq(vec![])),
    ]
    .concat());
    let usage = seq([
        oid(&[2, 5, 29, 15]),
        der(0x01, vec![0xff]),
        der(0x04, der(0x03, vec![7, 0x80])),
    ]
    .concat());
    let extended = seq([
        oid(&[2, 5, 29, 37]),
        der(0x04, seq(oid(&[1, 3, 6, 1, 5, 5, 7, 3, 1]))),
    ]
    .concat());
    let alt = seq([
        oid(&[2, 5, 29, 17]),
        der(
            0x04,
            seq(der(0x82, format!("agenthud-{device}.local").into_bytes())),
        ),
    ]
    .concat());
    let tbs = seq([
        der(0xa0, der(0x02, vec![2])),
        der(0x02, serial),
        algorithm.clone(),
        name.clone(),
        validity,
        name,
        public_info,
        der(0xa3, seq([constraints, usage, extended, alt].concat())),
    ]
    .concat());
    let signature = key
        .create_signature(Algorithm::ECDSASignatureMessageX962SHA256, &tbs)
        .map_err(|_| "LAN certificate signature")?;
    Ok(seq([
        tbs,
        algorithm,
        der(0x03, [vec![0], signature].concat()),
    ]
    .concat()))
}
fn der(tag: u8, value: Vec<u8>) -> Vec<u8> {
    let length = value.len();
    let mut bytes = vec![tag];
    if length < 128 {
        bytes.push(length as u8);
    } else {
        let raw = length.to_be_bytes();
        let start = raw.iter().position(|b| *b != 0).unwrap_or(raw.len() - 1);
        bytes.push(0x80 | (raw.len() - start) as u8);
        bytes.extend_from_slice(&raw[start..]);
    }
    bytes.extend(value);
    bytes
}
fn seq(value: Vec<u8>) -> Vec<u8> {
    der(0x30, value)
}
fn oid(parts: &[u64]) -> Vec<u8> {
    let mut bytes = vec![(parts[0] * 40 + parts[1]) as u8];
    for part in &parts[2..] {
        let mut value = *part;
        let mut encoded = vec![(value & 0x7f) as u8];
        value >>= 7;
        while value > 0 {
            encoded.insert(0, ((value & 0x7f) | 0x80) as u8);
            value >>= 7;
        }
        bytes.extend(encoded);
    }
    der(0x06, bytes)
}
