use actix_cors::Cors;
use actix_web::{get, web, App, HttpRequest, HttpResponse, HttpServer, Responder};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;

#[derive(Clone)]
struct AppConfig {
    tenant_id: String,
    api_audience: String, // aud
    required_scope: String,
}

impl AppConfig {
    fn from_env() -> Self {
        let tenant_id = std::env::var("ENTRA_TENANT_ID").expect("ENTRA_TENANT_ID");
        let api_client_id = std::env::var("ENTRA_API_CLIENT_ID").expect("ENTRA_API_CLIENT_ID");
        let required_scope =
            std::env::var("ENTRA_REQUIRED_SCOPE").unwrap_or_else(|_| "access_as_user".to_string());

        // ✅ あなたのトークンは aud = "api://<API_CLIENT_ID>" 形式だったので、これを検証値にする
        let api_audience = format!("api://{}", api_client_id);

        Self {
            tenant_id,
            api_audience,
            required_scope,
        }
    }

    fn issuer_v1(&self) -> String {
        // ✅ あなたが貼ってくれた iss 形式
        format!("https://sts.windows.net/{}/", self.tenant_id)
    }

    fn issuer_v2(&self) -> String {
        // v2 の issuer になる場合もあるので保険で許可
        format!("https://login.microsoftonline.com/{}/v2.0", self.tenant_id)
    }

    fn openid_config_url(&self) -> String {
        format!(
            "https://login.microsoftonline.com/{}/v2.0/.well-known/openid-configuration",
            self.tenant_id
        )
    }
}

#[derive(Debug, Deserialize, Clone)]
struct OidcConfig {
    jwks_uri: String,
}

#[derive(Debug, Deserialize, Clone)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[derive(Debug, Deserialize, Clone)]
struct Jwk {
    kid: String,
    x5c: Option<Vec<String>>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize, Clone)]
struct Claims {
    aud: String,
    iss: String,
    exp: usize,
    scp: Option<String>,
    tid: Option<String>,
    oid: Option<String>,
    email: Option<String>,
    name: Option<String>,
}

async fn fetch_oidc_config(cfg: &AppConfig) -> actix_web::Result<OidcConfig> {
    let res = reqwest::Client::new()
        .get(cfg.openid_config_url())
        .send()
        .await
        .map_err(actix_web::error::ErrorUnauthorized)?;

    let json = res
        .json::<OidcConfig>()
        .await
        .map_err(actix_web::error::ErrorUnauthorized)?;
    Ok(json)
}

async fn fetch_jwks(jwks_uri: &str) -> actix_web::Result<Jwks> {
    let res = reqwest::Client::new()
        .get(jwks_uri)
        .send()
        .await
        .map_err(actix_web::error::ErrorUnauthorized)?;

    let json = res
        .json::<Jwks>()
        .await
        .map_err(actix_web::error::ErrorUnauthorized)?;
    Ok(json)
}

fn decoding_key_from_jwks(jwks: &Jwks, kid: &str) -> actix_web::Result<DecodingKey> {
    let jwk = jwks
        .keys
        .iter()
        .find(|k| k.kid == kid)
        .ok_or_else(|| actix_web::error::ErrorUnauthorized("kid not found"))?;

    let x5c0 = jwk
        .x5c
        .as_ref()
        .and_then(|v| v.first())
        .ok_or_else(|| actix_web::error::ErrorUnauthorized("x5c missing"))?;

    let pem = format!(
        "-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----",
        x5c0
    );

    DecodingKey::from_rsa_pem(pem.as_bytes())
        .map_err(|_| actix_web::error::ErrorUnauthorized("invalid rsa pem"))
}

async fn validate_bearer(req: &HttpRequest, cfg: &AppConfig) -> actix_web::Result<Claims> {
    let auth = req
        .headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| actix_web::error::ErrorUnauthorized("missing Authorization"))?;

    let token = auth
        .strip_prefix("Bearer ")
        .ok_or_else(|| actix_web::error::ErrorUnauthorized("invalid scheme"))?;

    // kid
    let header =
        decode_header(token).map_err(|_| actix_web::error::ErrorUnauthorized("bad jwt header"))?;
    let kid = header
        .kid
        .ok_or_else(|| actix_web::error::ErrorUnauthorized("missing kid"))?;

    // OIDC -> JWKS
    let oidc = fetch_oidc_config(cfg).await?;
    let jwks = fetch_jwks(&oidc.jwks_uri).await?;
    let key = decoding_key_from_jwks(&jwks, &kid)?;

    // Validation: aud + iss + exp
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[cfg.api_audience.clone()]);

    // ✅ iss は v1 / v2 どちらの可能性もあるので両方許可
    validation.set_issuer(&[cfg.issuer_v1(), cfg.issuer_v2()]);

    let data = decode::<Claims>(token, &key, &validation)
        .map_err(|_| actix_web::error::ErrorUnauthorized("jwt validation failed"))?;

    let claims = data.claims;

    // scope check
    let scp = claims
        .scp
        .as_deref()
        .ok_or_else(|| actix_web::error::ErrorForbidden("missing scp"))?;

    let ok = scp.split_whitespace().any(|s| s == cfg.required_scope);
    if !ok {
        return Err(actix_web::error::ErrorForbidden("missing required scope"));
    }

    Ok(claims)
}

#[get("/me")]
async fn me(req: HttpRequest, cfg: web::Data<AppConfig>) -> impl Responder {
    match validate_bearer(&req, &cfg).await {
        Ok(claims) => HttpResponse::Ok().json(serde_json::json!({
            "ok": true,
            "claims": claims
        })),
        Err(e) => {
            // actix_web::Error → HttpResponse に変換
            e.into()
        }
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let cfg = AppConfig::from_env();

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(cfg.clone()))
            // ✅ フロント(5173)から呼べるように CORS を許可
            .wrap(
                Cors::default()
                    .allowed_origin("http://localhost:5173")
                    .allowed_methods(vec!["GET"])
                    .allowed_headers(vec!["Authorization", "Content-Type"])
                    .supports_credentials()
                    .max_age(3600),
            )
            .service(me)
    })
    .bind(("0.0.0.0", 8080))?
    .run()
    .await
}
