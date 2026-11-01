use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
};
use chrono::Utc;
use password_hash::SaltString;
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{env, net::SocketAddr, sync::Arc};
use tokio::sync::RwLock;
use tower_http::services::ServeDir;
use uuid::Uuid;

#[derive(Clone, Serialize)]
struct Room {
    id: String,
    name: String,
    members: u8,
    unread: u8,
    pinned: bool,
    last: String,
    updated: i64,
    participant_names: Vec<String>,
    direct_key: Option<String>,
    direct_member_names: Option<Vec<String>>,
}
#[derive(Clone, Serialize)]
struct Message {
    id: String,
    room_id: String,
    sender: String,
    mine: bool,
    body: String,
    created: i64,
    unread: u8,
    read_by: Vec<String>,
}
#[derive(Clone, Serialize)]
struct Agreement {
    task: String,
    assignee: String,
    deadline: String,
}
#[derive(Clone, Serialize)]
struct Appointment {
    id: String,
    title: String,
    fields: Vec<ScheduleField>,
    creator: String,
    source_message_id: Option<String>,
    room_id: Option<String>,
}
#[derive(Clone, Serialize)]
struct ScheduleField {
    id: String,
    label: String,
    value: String,
}
#[derive(Deserialize)]
struct ScheduleFieldInput {
    label: String,
    value: String,
}
#[derive(Clone)]
struct DemoUser {
    id: Uuid,
    phone_hash: String,
    name: String,
    password_hash: String,
    avatar_url: Option<String>,
    ai_intervention: String,
}
#[derive(Clone)]
struct Data {
    users: Vec<DemoUser>,
    rooms: Vec<Room>,
    messages: Vec<Message>,
    agreements: Vec<Agreement>,
    appointments: Vec<Appointment>,
}
#[derive(Clone)]
struct App {
    data: Arc<RwLock<Data>>,
    db: Option<PgPool>,
}
#[derive(Deserialize)]
struct Send {
    sender: String,
    body: String,
}
#[derive(Deserialize)]
struct NewRoom {
    name: String,
    members: Option<Vec<String>>,
    direct_key: Option<String>,
    owner: Option<String>,
}
#[derive(Deserialize)]
struct InviteMembers {
    members: Vec<String>,
}
#[derive(Deserialize)]
struct ReadMessages {
    reader: String,
}
#[derive(Deserialize)]
struct NewAgreement {
    task: String,
    assignee: String,
    deadline: String,
}
#[derive(Deserialize)]
struct NewAppointment {
    title: String,
    date: Option<String>,
    place: Option<String>,
    fields: Option<Vec<ScheduleFieldInput>>,
    creator: Option<String>,
    source_message_id: Option<String>,
    room_id: Option<String>,
}
#[derive(Deserialize)]
struct UpdateAppointment {
    title: String,
    fields: Vec<ScheduleFieldInput>,
}
#[derive(Deserialize)]
struct ScheduleCheck {
    text: String,
    context: Option<Vec<String>>,
    sender: String,
}
#[derive(Deserialize)]
struct Credentials {
    name: String,
    phone: String,
    password: String,
    ai_intervention: Option<String>,
}
#[derive(Deserialize)]
struct AiCheck {
    text: String,
    ai_intervention: Option<String>,
    context: Option<Vec<String>>,
    sender: Option<String>,
}
#[derive(Deserialize)]
struct RewriteRequest {
    text: String,
    context: Option<Vec<String>>,
    sender: Option<String>,
}
#[derive(Deserialize)]
struct AiReport {
    reporter_name: String,
    original_text: String,
    ai_result: Option<String>,
}
#[derive(Deserialize)]
struct Preferences {
    ai_intervention: String,
}
#[derive(Deserialize)]
struct AvatarUpdate {
    avatar_url: Option<String>,
}
#[derive(Serialize)]
struct PublicUser {
    id: String,
    name: String,
    avatar_url: Option<String>,
    ai_intervention: String,
}
fn phone_hash(phone: &str) -> String {
    format!(
        "phone:{}",
        phone
            .chars()
            .filter(|c| c.is_ascii_digit())
            .collect::<String>()
    )
}
fn ai_level(value: Option<&str>) -> String {
    match value.unwrap_or("standard") {
        "off" | "light" | "standard" | "careful" => value.unwrap_or("standard").to_string(),
        _ => "standard".to_string(),
    }
}
fn user_out(
    id: Uuid,
    name: String,
    avatar_url: Option<String>,
    ai_intervention: String,
) -> PublicUser {
    PublicUser {
        id: id.to_string(),
        name,
        avatar_url,
        ai_intervention,
    }
}

async fn health() -> Json<serde_json::Value> {
    let storage = env::var("DATABASE_URL").is_ok();
    Json(
        serde_json::json!({"ok":true,"runtime":"rust","storage":storage,"version":"v2-foundation"}),
    )
}
async fn signup(
    State(app): State<App>,
    Json(input): Json<Credentials>,
) -> Result<Json<PublicUser>, StatusCode> {
    let name = input.name.trim();
    let phone = phone_hash(&input.phone);
    if name.is_empty()
        || input.phone.chars().filter(|c| c.is_ascii_digit()).count() < 7
        || input.password.len() < 6
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(input.password.as_bytes(), &salt)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .to_string();
    let id = Uuid::new_v4();
    let level = ai_level(input.ai_intervention.as_deref());
    if let Some(db) = &app.db {
        let result=sqlx::query("INSERT INTO retone_v2.users(id,phone_hash,name,password_hash,is_admin,ai_intervention) VALUES($1,$2,$3,$4,$5,$6)").bind(id).bind(&phone).bind(name).bind(&hash).bind(input.phone=="12341234"&&name=="12341234").bind(&level).execute(db).await;
        if result.is_err() {
            return Err(StatusCode::CONFLICT);
        };
    } else {
        let mut data = app.data.write().await;
        if data.users.iter().any(|user| user.phone_hash == phone) {
            return Err(StatusCode::CONFLICT);
        }
        data.users.push(DemoUser { id, phone_hash: phone, name: name.to_string(), password_hash: hash, avatar_url: None, ai_intervention: level.clone() });
    }
    Ok(Json(user_out(id, name.to_string(), None, level)))
}
async fn login(
    State(app): State<App>,
    Json(input): Json<Credentials>,
) -> Result<Json<PublicUser>, StatusCode> {
    let row = if let Some(db) = &app.db {
        sqlx::query_as::<_,(Uuid,String,Option<String>,String,String)>("SELECT id,name,avatar_url,password_hash,ai_intervention FROM retone_v2.users WHERE phone_hash=$1 AND name=$2 AND deleted_at IS NULL").bind(phone_hash(&input.phone)).bind(input.name.trim()).fetch_optional(db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::UNAUTHORIZED)?
    } else {
        let data = app.data.read().await;
        let user = data.users.iter().find(|user| user.phone_hash == phone_hash(&input.phone) && user.name == input.name.trim()).ok_or(StatusCode::UNAUTHORIZED)?;
        (user.id, user.name.clone(), user.avatar_url.clone(), user.password_hash.clone(), user.ai_intervention.clone())
    };
    let parsed = PasswordHash::new(&row.3).map_err(|_| StatusCode::UNAUTHORIZED)?;
    Argon2::default()
        .verify_password(input.password.as_bytes(), &parsed)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    Ok(Json(user_out(row.0, row.1, row.2, row.4)))
}
async fn users(State(app): State<App>) -> Result<Json<Vec<PublicUser>>, StatusCode> {
    let rows = if let Some(db) = &app.db {
        sqlx::query_as::<_,(Uuid,String,Option<String>,String)>("SELECT id,name,avatar_url,ai_intervention FROM retone_v2.users WHERE deleted_at IS NULL ORDER BY created_at").fetch_all(db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?
    } else {
        let data = app.data.read().await;
        data.users.iter().map(|user| (user.id, user.name.clone(), user.avatar_url.clone(), user.ai_intervention.clone())).collect()
    };
    Ok(Json(
        rows.into_iter()
            .map(|r| user_out(r.0, r.1, r.2, r.3))
            .collect(),
    ))
}
async fn update_preferences(
    State(app): State<App>,
    Path(id): Path<Uuid>,
    Json(input): Json<Preferences>,
) -> Result<Json<PublicUser>, StatusCode> {
    let level = ai_level(Some(&input.ai_intervention));
    let row = if let Some(db) = &app.db {
        sqlx::query_as::<_,(Uuid,String,Option<String>,String)>("UPDATE retone_v2.users SET ai_intervention=$1 WHERE id=$2 AND deleted_at IS NULL RETURNING id,name,avatar_url,ai_intervention").bind(&level).bind(id).fetch_optional(db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::NOT_FOUND)?
    } else {
        let mut data = app.data.write().await;
        let user = data.users.iter_mut().find(|user| user.id == id).ok_or(StatusCode::NOT_FOUND)?;
        user.ai_intervention = level.clone();
        (user.id, user.name.clone(), user.avatar_url.clone(), user.ai_intervention.clone())
    };
    Ok(Json(user_out(row.0, row.1, row.2, row.3)))
}
async fn update_avatar(
    State(app): State<App>,
    Path(id): Path<Uuid>,
    Json(input): Json<AvatarUpdate>,
) -> Result<Json<PublicUser>, StatusCode> {
    let avatar_url = input.avatar_url.filter(|url| url.len() <= 300_000);
    let row = if let Some(db) = &app.db {
        sqlx::query_as::<_, (Uuid, String, Option<String>, String)>("UPDATE retone_v2.users SET avatar_url=$1 WHERE id=$2 AND deleted_at IS NULL RETURNING id,name,avatar_url,ai_intervention")
            .bind(&avatar_url)
            .bind(id)
            .fetch_optional(db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .ok_or(StatusCode::NOT_FOUND)?
    } else {
        let mut data = app.data.write().await;
        let user = data.users.iter_mut().find(|user| user.id == id).ok_or(StatusCode::NOT_FOUND)?;
        user.avatar_url = avatar_url.clone();
        (user.id, user.name.clone(), user.avatar_url.clone(), user.ai_intervention.clone())
    };
    Ok(Json(user_out(row.0, row.1, row.2, row.3)))
}
async fn delete_account(State(app): State<App>, Path(id): Path<Uuid>) -> StatusCode {
    if let Some(db) = &app.db {
        match sqlx::query("UPDATE retone_v2.users SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL").bind(id).execute(db).await {
            Ok(result) if result.rows_affected() == 1 => StatusCode::NO_CONTENT,
            Ok(_) => StatusCode::NOT_FOUND,
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    } else {
        let mut data = app.data.write().await;
        let before = data.users.len();
        data.users.retain(|user| user.id != id);
        if data.users.len() < before { StatusCode::NO_CONTENT } else { StatusCode::NOT_FOUND }
    }
}
async fn ai_check(State(app): State<App>, Json(input): Json<AiCheck>) -> Json<serde_json::Value> {
    let text = input.text.trim();
    let normalized = text
        .to_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation())
        .collect::<String>();
    let level = ai_level(input.ai_intervention.as_deref());
    let context = input
        .context
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .take(6)
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");
    let sender = input.sender.as_deref().unwrap_or("현재 사용자").trim();
    let pass = [
        "ㅋㅋ",
        "ㅋㅋㅋ",
        "ㅋㅋㅋㅋ",
        "ㅋㅋㅋㅋㅋ",
        "ㅎㅎ",
        "ㅎㅎㅎ",
        "ㅎㅎㅎㅎ",
        "ㅎㅇ",
        "하이",
        "안녕",
        "안녕하세요",
        "응",
        "어",
        "웅",
        "넹",
        "네",
        "ㅇㅋ",
        "오케이",
        "ok",
        "yes",
        "no",
        "?",
        "!",
        "ㅇㅇ",
        "ㄱㄱ",
        "ㄴㄴ",
        "ㅂㅂ",
        "잘자",
        "고마워",
        "감사",
        "수고",
        "굿",
        "헐",
        "대박",
        "진짜",
        "맞아",
        "아니",
        "왜",
        "좋아",
        "좋다",
        "화이팅",
        "파이팅",
        "오",
        "오오",
        "와",
        "아",
        "앗",
        "헉",
        "엥",
        "ㄹㅇ",
        "레알",
        "ㅈㄱㄴ",
        "ㅊㅋ",
        "축하",
        "미안",
        "죄송",
        "괜찮아",
        "괜찮아요",
        "반가워",
        "반갑습니다",
        "다녀와",
        "잘가",
        "잘자요",
        "좋은밤",
        "굿밤",
        "굿모닝",
        "맛점",
        "맛저",
        "점심",
        "저녁",
        "ㅇㅈ",
        "ㅁㄹ",
        "모름",
        "ㄱㅅ",
        "감사해",
        "고생",
        "수고했어",
        "수고하세요",
        "파이팅",
    ];
    let bad = [
        "시발",
        "씨발",
        "시ㅂ",
        "ㅅㅂ",
        "ㅆㅂ",
        "개새끼",
        "개새",
        "병신",
        "ㅂㅅ",
        "ㅄ",
        "좆",
        "ㅈㄴ",
        "존나",
        "미친놈",
        "미친년",
        "꺼져",
        "죽어",
        "죽인다",
        "뒤져",
        "닥쳐",
        "엿먹어",
        "새끼",
        "년아",
        "놈아",
        "씹",
        "지랄",
        "ㅈㄹ",
        "ㅁㅊ",
        "fuck",
        "shit",
        "bitch",
        "asshole",
    ];
    if level == "off" || text.is_empty() || pass.iter().any(|p| text == *p || normalized == *p) {
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"fast"}),
        );
    }
    if bad.iter().any(|p| normalized.contains(p)) {
        let matched = bad
            .iter()
            .find(|p| normalized.contains(**p))
            .unwrap_or(&"강한 표현");
        return Json(
            serde_json::json!({"verdict":"WARN","suggestion":format!("‘{matched}’처럼 강도가 높은 표현은 상대가 내용보다 공격받는 느낌을 먼저 받을 수 있어요. 하고 싶은 요청이나 감정을 구체적으로 말해보면 어떨까요?"),"info":{"level":"none","note":null,"queries":[]},"source":"dictionary"}),
        );
    }
    if level == "light" {
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"light"}),
        );
    }
    let hash = format!(
        "{:x}",
        Sha256::digest(format!("v2:{level}:{normalized}").as_bytes())
    );
    if let Some(db) = &app.db {
        if let Ok(Some((verdict,suggestion,info_level,info_note,info_queries)))=sqlx::query_as::<_,(String,Option<String>,String,Option<String>,Vec<String>)>("SELECT verdict,suggestion,info_level,info_note,info_queries FROM retone_v2.ai_cache WHERE message_hash=$1").bind(&hash).fetch_optional(db).await{return Json(serde_json::json!({"verdict":verdict,"suggestion":suggestion,"info":{"level":info_level,"note":info_note,"queries":info_queries},"source":"cache"}));}
    }
    let Some(key) = env::var("OPENAI_API_KEY").ok() else {
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"unavailable"}),
        );
    };
    let prompt = format!(
        "너는 Re:Tone의 대화 거울이다. 판정자·검열자·사실확인 기관이 아니다. 현재 문장을 오직 '이렇게 들릴 수도 있어요'라는 제안으로만 비춘다.\n현재 문장은 반드시 '{sender}'가 작성했다. 최근 대화는 화자 이름과 함께 주어지며, 이름을 바꾸거나 상대가 하지 않은 행동을 만들지 마라.\n1) 심한 욕설·위협·명백한 조롱뿐 아니라, 비꼼·냉소·돌려 말하는 압박·상대를 작게 만드는 표현도 알아차린다. 친한 사이의 가벼운 농담은 WARN하지 않는다.\n2) WARN일 때 suggestion은 반드시 이 문장에 맞춰 두 문장으로 쓴다. 첫 문장은 실제 문제 지점(단어·어조·비꼼)을 따옴표로 구체적으로 짚고 왜 상대가 압박·비난·조롱으로 느낄 수 있는지 설명한다. 둘째 문장은 원래 의도를 살린 짧은 대체 표현을 제안한다. 최근 대화 맥락이 있다면 갈등의 원인과 사용자의 바람을 살리되, 맥락에 없는 사실을 만들지 마라.\n3) 정보 점검: 건강·안전·법·돈·정치·재난·통계·속보성 주장에 출처·날짜·원문이 빠졌다면 info.level=check. 진실·거짓을 판단하지 말고 출처와 날짜 확인을 제안한다.\n4) 현재 개입 강도는 {level}이다. standard는 뚜렷한 경우만, careful은 비꼼·오해 가능성까지 조금 더 꼼꼼히 본다.\n5) JSON만 출력: {{\"verdict\":\"PASS|WARN\",\"suggestion\":string|null,\"info\":{{\"level\":\"none|check\",\"note\":string|null,\"queries\":[string]}}}}. queries는 확인할 검색어 0~2개.\n최근 대화(없으면 무시):\n{context}\n현재 문장({sender} 작성): {text}"
    );
    let res = reqwest::Client::new()
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(key)
        .json(&serde_json::json!({"model":"gpt-4o-mini","input":prompt,"max_output_tokens":80}))
        .send()
        .await;
    let Ok(r) = res else {
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"fallback"}),
        );
    };
    let v = r.json::<serde_json::Value>().await.unwrap_or_default();
    let out = v["output"][0]["content"][0]["text"]
        .as_str()
        .unwrap_or("{}");
    let parsed = serde_json::from_str::<serde_json::Value>(out)
        .unwrap_or_else(|_| serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]}}));
    let verdict = parsed["verdict"].as_str().unwrap_or("PASS");
    let suggestion = parsed["suggestion"].as_str();
    let info_level = parsed["info"]["level"].as_str().unwrap_or("none");
    let info_note = parsed["info"]["note"].as_str();
    let info_queries = parsed["info"]["queries"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str())
                .take(2)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if let Some(db) = &app.db {
        let _=sqlx::query("INSERT INTO retone_v2.ai_cache(message_hash,verdict,suggestion,info_level,info_note,info_queries) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(message_hash) DO UPDATE SET verdict=EXCLUDED.verdict,suggestion=EXCLUDED.suggestion,info_level=EXCLUDED.info_level,info_note=EXCLUDED.info_note,info_queries=EXCLUDED.info_queries,checked_at=NOW()").bind(&hash).bind(verdict).bind(suggestion).bind(info_level).bind(info_note).bind(&info_queries).execute(db).await;
    }
    Json(
        serde_json::json!({"verdict":verdict,"suggestion":suggestion,"info":{"level":info_level,"note":info_note,"queries":info_queries},"source":"ai"}),
    )
}
async fn ai_rewrite(Json(input): Json<RewriteRequest>) -> Json<serde_json::Value> {
    let text = input.text.trim();
    if text.is_empty() {
        return Json(serde_json::json!({"suggestion":""}));
    }
    let context = input
        .context
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .take(6)
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");
    let sender = input.sender.as_deref().unwrap_or("현재 사용자").trim();
    // Common short insults should feel immediate and natural. They do not need
    // an external model call, which also avoids rewriting them word-by-word.
    let compact = text
        .chars()
        .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation())
        .collect::<String>();
    let quick = if compact == "야이나쁜놈아" {
        Some("지금 정말 화가 났어. 그렇게 하지 말아줘.")
    } else if compact == "야이씨발놈아" {
        Some("지금 정말 화가 났어. 그렇게 말하지 말아줘.")
    } else if compact == "풉바보" {
        Some("그 말은 듣기 싫어. 서로 존중해서 이야기하자.")
    } else {
        None
    };
    if context.is_empty() {
        if let Some(suggestion) = quick {
            return Json(serde_json::json!({"suggestion":suggestion,"error":""}));
        }
    }
    let Some(key) = env::var("OPENAI_API_KEY").ok() else {
        return Json(serde_json::json!({"suggestion":"","error":"OPENAI_API_KEY_MISSING"}));
    };
    let prompt = format!(
        "다음 채팅을 뜻은 최대한 유지하면서 상대가 덜 공격적으로 들릴 자연스러운 한국어로 바꿔줘. 판정·설명·따옴표 없이 바꾼 문장만 출력.\n중요: 원문은 반드시 '{sender}'가 작성했다. 최근 대화의 각 줄은 실제 화자 이름을 가진 기록이다. 원문에 있는 욕설은 '{sender}'가 한 말이므로, 그것만 근거로 상대가 욕하거나 잘못했다고 쓰지 마라. 상대가 한 구체 행동은 최근 대화에 상대 이름으로 명시된 경우에만 언급할 수 있다. 사실이 없으면 '네가 그렇게 욕해서'처럼 상대의 행동을 지어내지 말고, '{sender}' 자신의 감정과 앞으로의 대화 방식을 말해라.\n욕설·인신공격은 완곡한 욕설로 바꾸지 말고, 문장 전체의 요청·질문·상황은 살린 채 화난 감정과 상대에게 바라는 행동을 분명히 말해라. 상대의 구체 행동이 기록되어 있으면 두 문장 I-메시지로 써라. 원인이 없을 때는 예를 들어 '지금 너무 화가 났어. 서로 기분 상하게 말하지 말고 이야기하자.'처럼 자연스럽게 써라. 단어 하나만 바꾸지 마라.\n최근 대화(없으면 무시):\n{context}\n원문({sender} 작성): {text}"
    );
    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(key)
        .json(&serde_json::json!({"model":"gpt-4o-mini","input":prompt,"max_output_tokens":80}))
        .send()
        .await;
    let suggestion = match response {
        Ok(r) => r
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| {
                v["output"][0]["content"][0]["text"]
                    .as_str()
                    .map(str::trim)
                    .map(str::to_string)
            })
            .unwrap_or_default(),
        Err(_) => String::new(),
    };
    let error = if suggestion.is_empty() {
        "REWRITE_UNAVAILABLE"
    } else {
        ""
    };
    Json(serde_json::json!({"suggestion":suggestion,"error":error}))
}
async fn ai_schedule(Json(input): Json<ScheduleCheck>) -> Json<serde_json::Value> {
    let text = input.text.trim();
    let context = input
        .context
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .take(6)
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");
    let Some(key) = env::var("OPENAI_API_KEY").ok() else {
        return Json(serde_json::json!({"is_schedule":false}));
    };
    let prompt = format!(
        "너는 채팅에서 일정·약속·할 일을 찾는 도우미다. 함께 만나거나 놀거나 어디 가자는 제안뿐 아니라 '피피티 만들어줘', '발표 준비하자', '금요일까지 보고서 내자' 같은 구체적인 할 일 요청도 is_schedule=true로 판단한다. 단순 인사·과거 회상·가정은 false다. true라면 JSON만 출력: {{\"is_schedule\":true,\"title\":\"일정\",\"fields\":[{{\"label\":\"할일\",\"value\":string}},{{\"label\":\"누구\",\"value\":string}},{{\"label\":\"언제\",\"value\":string}},{{\"label\":\"어디\",\"value\":string}},...]}}. fields에는 반드시 할일·누구·언제·어디를 이 순서로 포함한다. 알 수 없는 값은 반드시 빈 문자열로 두고 '미정'이나 추측을 쓰지 마라. 예를 들어 '피피티 만들어줘'는 할일='피피티 만들기', 나머지는 빈 문자열이다. '금요일까지 바나나가 피피티 만들어'는 할일='피피티 만들기', 누구='바나나', 언제='금요일', 어디=''다. 필요할 때만 세부사항을 추가한다. false라면 {{\"is_schedule\":false}}만 출력한다.\n보낸 사람: {}\n최근 대화:\n{}\n현재 메시지: {}",
        input.sender.trim(), context, text
    );
    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(key)
        .json(&serde_json::json!({"model":"gpt-4o-mini","input":prompt,"max_output_tokens":180}))
        .send()
        .await;
    let parsed = match response {
        Ok(response) => response
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|value| value["output"][0]["content"][0]["text"].as_str().map(str::to_string))
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .unwrap_or_default(),
        Err(_) => serde_json::Value::Null,
    };
    if !parsed["is_schedule"].as_bool().unwrap_or(false) {
        return Json(serde_json::json!({"is_schedule":false}));
    }
    let mut fields = parsed["fields"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|field| Some(ScheduleFieldInput {
            label: field["label"].as_str()?.trim().to_string(),
            value: field["value"].as_str()?.trim().to_string(),
        }))
        .collect::<Vec<_>>();
    for label in ["할일", "누구", "언제", "어디"] {
        if !fields.iter().any(|field| field.label == label) {
            fields.push(ScheduleFieldInput { label: label.into(), value: String::new() });
        }
    }
    let fields = schedule_fields(fields);
    Json(serde_json::json!({
        "is_schedule":true,
        "title":parsed["title"].as_str().unwrap_or("새 일정").trim(),
        "fields":fields.into_iter().map(|field| serde_json::json!({"label":field.label,"value":field.value})).collect::<Vec<_>>()
    }))
}
async fn ai_support(Json(input): Json<RewriteRequest>) -> Json<serde_json::Value> {
    let text = input.text.trim();
    let Some(key) = env::var("OPENAI_API_KEY").ok() else {
        return Json(serde_json::json!({"reply":""}));
    };
    let prompt = format!(
        "너는 Re:Tone의 공감 대화 도우미다. 사용자의 감정을 짧게 되짚고, 상대에게 보낼 수 있는 따뜻하고 자연스러운 문장 1~2개를 제안해라. 판단하거나 훈계하지 말고, 한국어로 4문장 이내로 답해라. 사용자의 말: {text}"
    );
    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(key)
        .json(&serde_json::json!({"model":"gpt-4o-mini","input":prompt,"max_output_tokens":180}))
        .send()
        .await;
    let reply = match response {
        Ok(r) => r
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| {
                v["output"][0]["content"][0]["text"]
                    .as_str()
                    .map(str::to_string)
            })
            .unwrap_or_default(),
        Err(_) => String::new(),
    };
    Json(serde_json::json!({"reply":reply}))
}
async fn report_ai(
    State(app): State<App>,
    Json(input): Json<AiReport>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if input.reporter_name.trim().is_empty() || input.original_text.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    };
    if let Some(db) = &app.db {
        sqlx::query("INSERT INTO retone_v2.ai_reports(id,reporter_name,original_text,ai_result) VALUES($1,$2,$3,$4)").bind(Uuid::new_v4()).bind(input.reporter_name.trim()).bind(input.original_text.trim()).bind(input.ai_result).execute(db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    Ok(Json(serde_json::json!({"ok":true})))
}
async fn bootstrap(State(app): State<App>) -> Json<DataOut> {
    let d = app.data.read().await;
    Json(DataOut {
        rooms: d.rooms.clone(),
        agreements: d.agreements.clone(),
        appointments: d.appointments.clone(),
    })
}
#[derive(Serialize)]
struct DataOut {
    rooms: Vec<Room>,
    agreements: Vec<Agreement>,
    appointments: Vec<Appointment>,
}
async fn messages(State(app): State<App>, Path(id): Path<String>) -> Json<Vec<Message>> {
    let d = app.data.read().await;
    Json(
        d.messages
            .iter()
            .filter(|m| m.room_id == id)
            .cloned()
            .collect(),
    )
}
async fn send(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(input): Json<Send>,
) -> Result<Json<Message>, StatusCode> {
    let sender = input.sender.trim().chars().take(24).collect::<String>();
    if sender.is_empty() || input.body.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut d = app.data.write().await;
    let unread = d
        .rooms
        .iter()
        .find(|room| room.id == id)
        .map(|room| room.members.saturating_sub(1))
        .unwrap_or(0);
    let message = Message {
        id: Uuid::new_v4().to_string(),
        room_id: id.clone(),
        sender: sender.clone(),
        // A message is not intrinsically "mine": that depends on the person
        // currently looking at it. The browser compares the sender to its
        // signed-in user, so A's message is shown as incoming for B.
        mine: false,
        body: input.body.trim().to_string(),
        created: Utc::now().timestamp_millis(),
        unread,
        read_by: vec![sender],
    };
    d.messages.push(message.clone());
    if let Some(room) = d.rooms.iter_mut().find(|r| r.id == id) {
        room.last = message.body.clone();
        room.updated = message.created;
    }
    Ok(Json(message))
}
async fn delete_message(
    State(app): State<App>,
    Path((room_id, message_id)): Path<(String, String)>,
) -> StatusCode {
    let mut d = app.data.write().await;
    let before = d.messages.len();
    d.messages
        .retain(|m| !(m.room_id == room_id && m.id == message_id));
    if d.messages.len() < before {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}
async fn mark_messages_read(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(input): Json<ReadMessages>,
) -> StatusCode {
    let reader = input.reader.trim();
    if reader.is_empty() {
        return StatusCode::BAD_REQUEST;
    }
    let mut data = app.data.write().await;
    for message in data.messages.iter_mut().filter(|message| message.room_id == id) {
        if message.sender != reader && !message.read_by.iter().any(|name| name == reader) {
            message.read_by.push(reader.to_string());
            message.unread = message.unread.saturating_sub(1);
        }
    }
    StatusCode::NO_CONTENT
}
async fn create_room(
    State(app): State<App>,
    Json(input): Json<NewRoom>,
) -> Result<Json<Room>, StatusCode> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let direct_key = input
        .direct_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(|key| key.chars().take(100).collect::<String>());
    let owner = input.owner.as_deref().unwrap_or("").trim().chars().take(24).collect::<String>();
    let mut participant_names = Vec::new();
    for member in input.members.unwrap_or_default() {
        let member = member.trim().chars().take(24).collect::<String>();
        if !member.is_empty() && !participant_names.contains(&member) {
            participant_names.push(member);
        }
    }
    let direct_member_names = direct_key.as_ref().map(|_| {
        let mut names = Vec::new();
        if !owner.is_empty() {
            names.push(owner.clone());
        }
        for member in &participant_names {
            if !names.contains(member) {
                names.push(member.clone());
            }
        }
        names
    });
    let mut data = app.data.write().await;
    if let Some(key) = &direct_key {
        if let Some(room) = data
            .rooms
            .iter()
            .find(|room| room.direct_key.as_ref() == Some(key))
        {
            return Ok(Json(room.clone()));
        }
    }
    let room = Room {
        id: Uuid::new_v4().to_string(),
        name: name.chars().take(30).collect(),
        members: direct_member_names.as_ref().map(|names| names.len()).unwrap_or(participant_names.len() + 1).min(u8::MAX as usize) as u8,
        unread: 0,
        pinned: false,
        last: "새 대화를 시작해 보세요.".into(),
        updated: Utc::now().timestamp_millis(),
        participant_names,
        direct_key,
        direct_member_names,
    };
    data.rooms.push(room.clone());
    Ok(Json(room))
}
async fn invite_members(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(input): Json<InviteMembers>,
) -> Result<Json<Room>, StatusCode> {
    let mut data = app.data.write().await;
    let room = data.rooms.iter_mut().find(|room| room.id == id).ok_or(StatusCode::NOT_FOUND)?;
    for member in input.members {
        let member = member.trim().chars().take(24).collect::<String>();
        if !member.is_empty() && !room.participant_names.contains(&member) {
            room.participant_names.push(member);
        }
    }
    room.members = (room.participant_names.len() + 1).min(u8::MAX as usize) as u8;
    Ok(Json(room.clone()))
}
async fn create_agreement(
    State(app): State<App>,
    Json(input): Json<NewAgreement>,
) -> Result<Json<Agreement>, StatusCode> {
    if input.task.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let agreement = Agreement {
        task: input.task.trim().chars().take(100).collect(),
        assignee: if input.assignee.trim().is_empty() {
            "미정".into()
        } else {
            input.assignee.trim().chars().take(24).collect()
        },
        deadline: if input.deadline.trim().is_empty() {
            "미정".into()
        } else {
            input.deadline.trim().chars().take(40).collect()
        },
    };
    app.data.write().await.agreements.push(agreement.clone());
    Ok(Json(agreement))
}
fn schedule_fields(inputs: Vec<ScheduleFieldInput>) -> Vec<ScheduleField> {
    inputs
        .into_iter()
        .filter_map(|field| {
            let label = field.label.trim().chars().take(20).collect::<String>();
            let value = field.value.trim().chars().take(100).collect::<String>();
            (!label.is_empty()).then(|| ScheduleField { id: Uuid::new_v4().to_string(), label, value })
        })
        .take(12)
        .collect()
}
fn default_schedule_fields(creator: &str, date: Option<&str>, place: Option<&str>) -> Vec<ScheduleFieldInput> {
    vec![
        ScheduleFieldInput { label: "할일".into(), value: String::new() },
        ScheduleFieldInput { label: "누구".into(), value: creator.trim().into() },
        ScheduleFieldInput { label: "언제".into(), value: date.unwrap_or("").trim().into() },
        ScheduleFieldInput { label: "어디".into(), value: place.unwrap_or("").trim().into() },
    ]
}
async fn create_appointment(
    State(app): State<App>,
    Json(input): Json<NewAppointment>,
) -> Result<Json<Appointment>, StatusCode> {
    let NewAppointment { title, date, place, fields, creator, source_message_id, room_id } = input;
    let title = title.trim();
    if title.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let creator = creator.as_deref().unwrap_or("").trim().chars().take(24).collect::<String>();
    let source_message_id = source_message_id.as_deref().map(str::trim).filter(|id| !id.is_empty()).map(str::to_string);
    let fields = schedule_fields(fields.unwrap_or_else(|| default_schedule_fields(&creator, date.as_deref(), place.as_deref())));
    let mut data = app.data.write().await;
    if let Some(source_message_id) = &source_message_id {
        if let Some(existing) = data.appointments.iter().find(|appointment| appointment.source_message_id.as_ref() == Some(source_message_id)) {
            return Ok(Json(existing.clone()));
        }
    }
    let room_id = room_id.as_deref().map(str::trim).filter(|id| !id.is_empty()).map(str::to_string);
    let appointment = Appointment { id: Uuid::new_v4().to_string(), title: title.chars().take(80).collect(), fields, creator, source_message_id, room_id };
    data.appointments.push(appointment.clone());
    Ok(Json(appointment))
}
async fn update_appointment(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(input): Json<UpdateAppointment>,
) -> Result<Json<Appointment>, StatusCode> {
    if input.title.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut data = app.data.write().await;
    let appointment = data.appointments.iter_mut().find(|appointment| appointment.id == id).ok_or(StatusCode::NOT_FOUND)?;
    appointment.title = input.title.trim().chars().take(80).collect();
    appointment.fields = schedule_fields(input.fields);
    Ok(Json(appointment.clone()))
}
async fn delete_appointment(State(app): State<App>, Path(id): Path<String>) -> StatusCode {
    let mut data = app.data.write().await;
    let before = data.appointments.len();
    data.appointments.retain(|appointment| appointment.id != id);
    if data.appointments.len() < before { StatusCode::NO_CONTENT } else { StatusCode::NOT_FOUND }
}

async fn prepare_storage() -> Option<PgPool> {
    let url = env::var("DATABASE_URL").ok()?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .ok()?;
    let migration = include_str!("../migrations/0001_retone_v2.sql");
    if sqlx::raw_sql(migration).execute(&pool).await.is_err() {
        return None;
    }
    Some(pool)
}

#[tokio::main]
async fn main() {
    let db = prepare_storage().await;
    let app_state = App {
        db,
        data: Arc::new(RwLock::new(Data {
            users: vec![],
            rooms: vec![],
            messages: vec![],
            agreements: vec![],
            appointments: vec![],
        })),
    };
    let router = Router::new()
        .route("/api/health", get(health))
        .route("/api/auth/signup", post(signup))
        .route("/api/auth/login", post(login))
        .route("/api/users", get(users))
        .route("/api/users/{id}/preferences", patch(update_preferences))
        .route("/api/users/{id}/avatar", patch(update_avatar))
        .route("/api/users/{id}", delete(delete_account))
        .route("/api/ai/check", post(ai_check))
        .route("/api/ai/rewrite", post(ai_rewrite))
        .route("/api/ai/schedule", post(ai_schedule))
        .route("/api/ai/support", post(ai_support))
        .route("/api/ai/reports", post(report_ai))
        .route("/api/bootstrap", get(bootstrap))
        .route("/api/rooms", post(create_room))
        .route("/api/rooms/{id}/members", post(invite_members))
        .route("/api/agreements", post(create_agreement))
        .route("/api/appointments", post(create_appointment))
        .route("/api/appointments/{id}", patch(update_appointment).delete(delete_appointment))
        .route("/api/rooms/{id}/messages", get(messages).post(send))
        .route("/api/rooms/{id}/read", post(mark_messages_read))
        .route(
            "/api/rooms/{room_id}/messages/{message_id}",
            delete(delete_message),
        )
        .with_state(app_state)
        .fallback_service(ServeDir::new("public"));
    let port = env::var("PORT")
        .unwrap_or_else(|_| "4000".into())
        .parse()
        .unwrap();
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port)))
        .await
        .unwrap();
    println!("Re:Tone v2 on {port}");
    axum::serve(listener, router).await.unwrap();
}
