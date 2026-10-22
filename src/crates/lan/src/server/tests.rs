use super::*;
use crate::credentials::SecretStore;

#[derive(Clone, PartialEq, Serialize)]
struct Item(String);
impl Record for Item {
    fn id(&self) -> String {
        self.0.clone()
    }
    fn device_id(&self) -> &str {
        "fixture"
    }
    fn is_visible(&self, _: i64) -> bool {
        true
    }
    fn modified_at_ms(&self) -> i64 {
        0
    }
    fn content(&self) -> String {
        self.0.clone()
    }
}

#[derive(Debug)]
struct NoCertificate;
impl rustls::server::ResolvesServerCert for NoCertificate {
    fn resolve(
        &self,
        _: rustls::server::ClientHello<'_>,
    ) -> Option<Arc<rustls::sign::CertifiedKey>> {
        panic!("address projection must not open TLS")
    }
}
#[derive(Default)]
struct Secrets(Mutex<BTreeMap<String, Vec<u8>>>);
impl SecretStore for Secrets {
    fn read(&self, _: &str, account: &str) -> Result<Option<Vec<u8>>> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }
    fn write(&self, _: &str, account: &str, bytes: &[u8]) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .insert(account.to_owned(), bytes.to_vec());
        Ok(())
    }
}

#[test]
fn connection_projection_follows_address_and_account_without_stale_cache() {
    let directory = std::env::temp_dir().join(format!("lan-address-{}", uuid::Uuid::new_v4()));
    let credentials =
        Credentials::new("fixture", directory.clone(), Arc::new(Secrets::default())).unwrap();
    let tls = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_cert_resolver(Arc::new(NoCertificate));
    let identity = Identity {
        certificate: vec![],
        fingerprint: "fixture-certificate".into(),
        tls: Arc::new(tls),
    };
    let server = LanServer::new(
        "fixture".into(),
        "Fixture".into(),
        credentials,
        Arc::new(Mutex::new(
            SnapshotCache::<Item>::new(
                "fixture".into(),
                "Fixture".into(),
                directory.join("cursor.json"),
            )
            .unwrap(),
        )),
        identity,
        Arc::new(|_, _| Ok(None)),
    );
    assert!(server.set_account(Some("first-account")).unwrap().is_none());
    assert!(server.set_endpoint(Some("https://192.0.2.1:1234".into())));
    let first = server.local_connection().unwrap();
    assert!(!server.set_endpoint(Some("https://192.0.2.1:1234".into())));
    assert!(server.set_endpoint(Some("https://192.0.2.2:1234".into())));
    let connection = server.local_connection().unwrap();
    assert_eq!(connection["endpoint"], "https://192.0.2.2:1234");
    assert_eq!(connection["token"], first["token"]);
    assert!(server.set_endpoint(None));
    assert!(server.local_connection().is_none());
    assert!(server.set_endpoint(Some("https://192.0.2.3:1234".into())));
    assert_eq!(server.local_connection().unwrap()["token"], first["token"]);
    server.set_account(None).unwrap();
    assert!(server.local_connection().is_none());
    let other = server.set_account(Some("second-account")).unwrap().unwrap();
    assert_ne!(other["token"], first["token"]);
    assert_eq!(other["endpoint"], "https://192.0.2.3:1234");
}
