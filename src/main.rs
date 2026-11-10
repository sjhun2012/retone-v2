mod ai_rules;
mod ai_transport;
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
    participant_ids: Vec<String>,
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
    status_message: String,
    ai_intervention: String,
}
#[derive(Clone)]
struct Data {
    users: Vec<DemoUser>,
    rooms: Vec<Room>,
    messages: Vec<Message>,
    agreements: Vec<Agreement>,
    appointments: Vec<Appointment>,
    friend_requests: Vec<FriendRequest>,
    friendships: Vec<Friendship>,
}
#[derive(Clone)]
struct FriendRequest {
    id: String,
    from_id: Uuid,
    to_id: Uuid,
}
#[derive(Clone)]
struct Friendship {
    first_id: Uuid,
    second_id: Uuid,
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
    owner_id: Option<String>,
    member_ids: Option<Vec<String>>,
}
#[derive(Deserialize)]
struct FriendRequestInput {
    sender_id: Uuid,
    phone: String,
}
#[derive(Serialize)]
struct FriendRequestOut {
    id: String,
    user: PublicUser,
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
#[derive(Deserialize)]
struct StatusUpdate {
    status_message: String,
}
#[derive(Clone, Serialize)]
struct PublicUser {
    id: String,
    name: String,
    avatar_url: Option<String>,
    status_message: String,
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
    status_message: String,
    ai_intervention: String,
) -> PublicUser {
    PublicUser {
        id: id.to_string(),
        name,
        avatar_url,
        status_message,
        ai_intervention,
    }
}
fn are_friends(friendships: &[Friendship], first: Uuid, second: Uuid) -> bool {
    friendships.iter().any(|friendship| {
        (friendship.first_id == first && friendship.second_id == second)
            || (friendship.first_id == second && friendship.second_id == first)
    })
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
        data.users.push(DemoUser { id, phone_hash: phone, name: name.to_string(), password_hash: hash, avatar_url: None, status_message: String::new(), ai_intervention: level.clone() });
    }
    Ok(Json(user_out(id, name.to_string(), None, String::new(), level)))
}
async fn login(
    State(app): State<App>,
    Json(input): Json<Credentials>,
) -> Result<Json<PublicUser>, StatusCode> {
    let row = if let Some(db) = &app.db {
        sqlx::query_as::<_,(Uuid,String,Option<String>,String,String,String)>("SELECT id,name,avatar_url,password_hash,status_message,ai_intervention FROM retone_v2.users WHERE phone_hash=$1 AND name=$2 AND deleted_at IS NULL").bind(phone_hash(&input.phone)).bind(input.name.trim()).fetch_optional(db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::UNAUTHORIZED)?
    } else {
        let data = app.data.read().await;
        let user = data.users.iter().find(|user| user.phone_hash == phone_hash(&input.phone) && user.name == input.name.trim()).ok_or(StatusCode::UNAUTHORIZED)?;
        (user.id, user.name.clone(), user.avatar_url.clone(), user.password_hash.clone(), user.status_message.clone(), user.ai_intervention.clone())
    };
    let parsed = PasswordHash::new(&row.3).map_err(|_| StatusCode::UNAUTHORIZED)?;
    Argon2::default()
        .verify_password(input.password.as_bytes(), &parsed)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    Ok(Json(user_out(row.0, row.1, row.2, row.4, row.5)))
}
async fn users(State(app): State<App>) -> Result<Json<Vec<PublicUser>>, StatusCode> {
    let rows = if let Some(db) = &app.db {
        sqlx::query_as::<_,(Uuid,String,Option<String>,String,String)>("SELECT id,name,avatar_url,status_message,ai_intervention FROM retone_v2.users WHERE deleted_at IS NULL ORDER BY created_at").fetch_all(db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?
    } else {
        let data = app.data.read().await;
        data.users.iter().map(|user| (user.id, user.name.clone(), user.avatar_url.clone(), user.status_message.clone(), user.ai_intervention.clone())).collect()
    };
    Ok(Json(
        rows.into_iter()
            .map(|r| user_out(r.0, r.1, r.2, r.3, r.4))
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
        sqlx::query_as::<_,(Uuid,String,Option<String>,String,String)>("UPDATE retone_v2.users SET ai_intervention=$1 WHERE id=$2 AND deleted_at IS NULL RETURNING id,name,avatar_url,status_message,ai_intervention").bind(&level).bind(id).fetch_optional(db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::NOT_FOUND)?
    } else {
        let mut data = app.data.write().await;
        let user = data.users.iter_mut().find(|user| user.id == id).ok_or(StatusCode::NOT_FOUND)?;
        user.ai_intervention = level.clone();
        (user.id, user.name.clone(), user.avatar_url.clone(), user.status_message.clone(), user.ai_intervention.clone())
    };
    Ok(Json(user_out(row.0, row.1, row.2, row.3, row.4)))
}
async fn update_avatar(
    State(app): State<App>,
    Path(id): Path<Uuid>,
    Json(input): Json<AvatarUpdate>,
) -> Result<Json<PublicUser>, StatusCode> {
    let avatar_url = input.avatar_url.filter(|url| url.len() <= 300_000);
    let row = if let Some(db) = &app.db {
        sqlx::query_as::<_, (Uuid, String, Option<String>, String, String)>("UPDATE retone_v2.users SET avatar_url=$1 WHERE id=$2 AND deleted_at IS NULL RETURNING id,name,avatar_url,status_message,ai_intervention")
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
        (user.id, user.name.clone(), user.avatar_url.clone(), user.status_message.clone(), user.ai_intervention.clone())
    };
    Ok(Json(user_out(row.0, row.1, row.2, row.3, row.4)))
}
async fn update_status(
    State(app): State<App>,
    Path(id): Path<Uuid>,
    Json(input): Json<StatusUpdate>,
) -> Result<Json<PublicUser>, StatusCode> {
    let status = input.status_message.trim().chars().take(60).collect::<String>();
    let row = if let Some(db) = &app.db {
        sqlx::query_as::<_, (Uuid, String, Option<String>, String, String)>("UPDATE retone_v2.users SET status_message=$1 WHERE id=$2 AND deleted_at IS NULL RETURNING id,name,avatar_url,status_message,ai_intervention")
            .bind(&status)
            .bind(id)
            .fetch_optional(db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .ok_or(StatusCode::NOT_FOUND)?
    } else {
        let mut data = app.data.write().await;
        let user = data.users.iter_mut().find(|user| user.id == id).ok_or(StatusCode::NOT_FOUND)?;
        user.status_message = status.clone();
        (user.id, user.name.clone(), user.avatar_url.clone(), user.status_message.clone(), user.ai_intervention.clone())
    };
    Ok(Json(user_out(row.0, row.1, row.2, row.3, row.4)))
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
        let Some(name) = data.users.iter().find(|user| user.id == id).map(|user| user.name.clone()) else {
            return StatusCode::NOT_FOUND;
        };
        data.users.retain(|user| user.id != id);
        data.friend_requests.retain(|request| request.from_id != id && request.to_id != id);
        data.friendships.retain(|friendship| friendship.first_id != id && friendship.second_id != id);
        let removed_room_ids = data.rooms.iter().filter(|room| room.participant_ids.iter().any(|member_id| member_id == &id.to_string()) || room.direct_member_names.as_ref().is_some_and(|names| names.contains(&name))).map(|room| room.id.clone()).collect::<Vec<_>>();
        data.rooms.retain(|room| !removed_room_ids.contains(&room.id));
        data.messages.retain(|message| !removed_room_ids.contains(&message.room_id));
        StatusCode::NO_CONTENT
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
    if level == "off" || text.is_empty() || pass.iter().any(|p| text == *p || normalized == *p) {
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"fast"}),
        );
    }
    let attack = ai_rules::strong_expression(text).map(|term| (term, "dictionary"))
        .or_else(|| if level != "light" { ai_rules::hostility(text).map(|term| (term, "rules")) } else { None });
    if let Some((matched, source)) = attack {
        return Json(serde_json::json!({"verdict":"WARN","suggestion":format!("‘{matched}’ 표현은 상대에게 공격적으로 들릴 수 있어요. 감정이나 원하는 행동을 구체적으로 말해볼까요?"),"info":{"level":"none","note":null,"queries":[]},"source":source}));
    }
    if level == "light" {
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"light"}),
        );
    }
    let hash = format!(
        "{:x}",
        Sha256::digest(format!("v6:{level}:{text}:{sender}:{context}").as_bytes())
    );
    if let Some(db) = &app.db {
        if let Ok(Some((verdict,suggestion,info_level,info_note,info_queries)))=sqlx::query_as::<_,(String,Option<String>,String,Option<String>,Vec<String>)>("SELECT verdict,suggestion,info_level,info_note,info_queries FROM retone_v2.ai_cache WHERE message_hash=$1").bind(&hash).fetch_optional(db).await{return Json(serde_json::json!({"verdict":verdict,"suggestion":suggestion,"info":{"level":info_level,"note":info_note,"queries":info_queries},"source":"cache"}));}
    }
    let Some(_key) = env::var("OPENAI_API_KEY").ok() else {
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"unavailable","error":"AI_CHECK_UNAVAILABLE"}),
        );
    };
    let prompt = format!(
        "너는 Re:Tone의 대화 거울이다. 판정자·검열자·사실확인 기관이 아니다. 현재 문장을 오직 '이렇게 들릴 수도 있어요'라는 제안으로만 비춘다.\n현재 문장은 반드시 '{sender}'가 작성했다. 최근 대화는 화자 이름과 함께 주어지며, 이름을 바꾸거나 상대가 하지 않은 행동을 만들지 마라.\n1) 심한 욕설·위협·명백한 조롱뿐 아니라, 비꼼·냉소·돌려 말하는 압박·상대를 작게 만드는 표현도 알아차린다. 친한 사이의 가벼운 농담은 WARN하지 않는다.\n2) WARN일 때 suggestion은 반드시 이 문장에 맞춰 두 문장으로 쓴다. 첫 문장은 실제 문제 지점(단어·어조·비꼼)을 따옴표로 구체적으로 짚고 왜 상대가 압박·비난·조롱으로 느낄 수 있는지 설명한다. 둘째 문장은 원래 의도를 살린 짧은 대체 표현을 제안한다. 최근 대화 맥락이 있다면 갈등의 원인과 사용자의 바람을 살리되, 맥락에 없는 사실을 만들지 마라.\n3) 정보 점검: 건강·안전·법·돈·정치·재난·통계·속보성 주장에 검증 가능한 출처·날짜·원문이 빠졌다면 info.level=check. 앞선 대화에 인터넷 글·댓글·전언이 나와도 검증 가능한 출처로 취급하지 않는다. 약의 효능, 투자 수익, 계약의 효력, 대피 명령처럼 행동에 영향을 주는 단정은 빠뜨리지 않는다. 진실·거짓을 판단하지 말고 출처와 날짜 확인을 제안한다. WARN은 상대방을 공격하거나 위협하는 말에만 쓴다. 출처가 불확실한 정보 자체는 WARN 사유가 아니다.\n4) 현재 개입 강도는 {level}이다. standard는 뚜렷한 경우만, careful은 비꼼·오해 가능성까지 조금 더 꼼꼼히 본다.\n5) JSON만 출력: {{\"verdict\":\"PASS|WARN\",\"suggestion\":string|null,\"info\":{{\"level\":\"none|check\",\"note\":string|null,\"queries\":[string]}}}}. queries는 확인할 검색어 0~2개.\n최근 대화(없으면 무시):\n{context}\n현재 문장({sender} 작성): {text}"
    );
    let parsed = match ai_transport::json_response(&prompt, ai_transport::check_schema(), 700).await {
        Some(value) if matches!(value["verdict"].as_str(), Some("PASS" | "WARN")) => value,
        _ => return Json(serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"unavailable","error":"AI_CHECK_UNAVAILABLE"})),
    };
    // Factual claims can be returned as WARN by the model even though there is
    // no person-directed attack. Keep the intervention as a source check.
    let source_check = ai_rules::unverified_sensitive_claim(text);
    let verdict = if source_check { "PASS" } else { parsed["verdict"].as_str().unwrap_or("PASS") };
    let suggestion = if source_check { None } else { parsed["suggestion"].as_str() };
    let info_level = if source_check { "check" } else { parsed["info"]["level"].as_str().unwrap_or("none") };
    let info_note = parsed["info"]["note"].as_str().or(if source_check { Some("출처와 발표 날짜를 확인해 주세요.") } else { None });
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
    let context_compact = context
        .chars()
        .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation())
        .collect::<String>();
    let dismissive_reply = ["알빠야", "내알바야", "니상관아니야", "네상관아니야"]
        .iter()
        .any(|phrase| compact.contains(phrase));
    let lateness_complaint = context.contains("[상대]")
        && ["왜안와", "왜안왔", "늦었", "늦어", "기다렸", "약속시간"]
            .iter()
            .any(|phrase| context_compact.contains(phrase));
    if dismissive_reply && lateness_complaint {
        return Json(serde_json::json!({"suggestion":"늦어서 미안해. 다음에는 미리 연락할게.","error":""}));
    }
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
    let prompt = format!(
        "다음 채팅을 뜻은 최대한 유지하면서 상대가 덜 공격적으로 들릴 자연스러운 한국어로 바꿔줘. 판정·설명·따옴표 없이 바꾼 문장만 출력.\n중요: 원문은 반드시 '{sender}'가 작성했다. 최근 대화에는 [현재 사용자]와 [상대] 역할표가 있다. 상대의 감정·불만을 현재 사용자의 감정으로 복사하지 마라. 예를 들어 [상대]가 '너 왜 안 와?'라고 했다고 해서 '{sender}'에게 '내가 기대했는데 네가 늦어서 속상해'라고 쓰게 하면 안 된다. 단, 상대가 현재 사용자의 늦음·실수·약속 변경을 구체적으로 지적했고 현재 사용자가 '알빠야?', '니 상관 아니야'처럼 방어적으로 답하려 한다면, 상대의 대사를 흉내 내지 말고 현재 사용자가 책임지는 사과로 바꿔라. 예: '늦어서 미안해. 다음에는 미리 연락할게.' 원문에 있는 욕설도 '{sender}'가 한 말이므로, 그것만 근거로 상대가 욕하거나 잘못했다고 쓰지 마라.\n욕설·인신공격은 완곡한 욕설로 바꾸지 말고, 문장 전체의 요청·질문·상황은 살린 채 화난 감정과 상대에게 바라는 행동을 분명히 말해라. 사실이 부족하면 상대 행동을 지어내지 말고 중립적인 감정과 대화 방식을 말해라. 단어 하나만 바꾸지 마라.\n최근 대화(없으면 무시):\n{context}\n원문({sender} 작성): {text}"
    );
    if let Some(suggestion) = ai_transport::text_response(&prompt, 350).await {
        return Json(serde_json::json!({"suggestion":suggestion,"error":"","source":"ai"}));
    }
    if let Some(suggestion) = ai_rules::rewrite_fallback(text, &context) {
        return Json(serde_json::json!({"suggestion":suggestion,"error":"","source":"rules"}));
    }
    Json(serde_json::json!({"suggestion":"","error":"REWRITE_UNAVAILABLE"}))
}

async fn ai_schedule(Json(input): Json<ScheduleCheck>) -> Json<serde_json::Value> {
    let text = input.text.trim();
    if ai_rules::schedule_negative(text) {
        return Json(serde_json::json!({"is_schedule":false,"source":"rules"}));
    }
    if let Some(plan) = ai_rules::local_plan(text, input.context.as_deref().unwrap_or(&[])) {
        return Json(serde_json::json!({"is_schedule":true,"title":"일정","source":"rules","fields":[
            {"label":"할일","value":plan.task},{"label":"누구","value":plan.who},
            {"label":"언제","value":plan.when},{"label":"어디","value":plan.place}
        ]}));
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
    let prompt = format!(
        "너는 채팅에서 새 일정·약속·할 일을 찾는 도우미다. 앞으로 할 일을 제안하거나 확정하는 문장만 true다. 함께 만나거나 놀거나 어디 가자는 새 제안, '피피티 만들어줘', '발표 준비하자', '금요일까지 보고서 내자' 같은 구체적인 할 일 요청은 true다. 이미 진행 중인 약속에서 하는 재촉·항의·상태 확인은 일정이 아니다. '왜 안 와?', '빨리 와', '언제 와?', '지금 8시 30분이잖아'는 절대 false다. 단순 인사·과거 회상·가정도 false다. true라면 JSON만 출력: {{\"is_schedule\":true,\"title\":\"일정\",\"fields\":[{{\"label\":\"할일\",\"value\":string}},{{\"label\":\"누구\",\"value\":string}},{{\"label\":\"언제\",\"value\":string}},{{\"label\":\"어디\",\"value\":string}},...]}}. fields에는 반드시 할일·누구·언제·어디를 이 순서로 포함한다. 알 수 없는 값은 반드시 빈 문자열로 두고 '미정'이나 추측을 쓰지 마라. 예를 들어 '피피티 만들어줘'는 할일='피피티 만들기', 나머지는 빈 문자열이다. '금요일까지 바나나가 피피티 만들어'는 할일='피피티 만들기', 누구='바나나', 언제='금요일', 어디=''다. 필요할 때만 세부사항을 추가한다. false라면 {{\"is_schedule\":false,\"title\":\"\",\"fields\":[]}}만 출력한다.\n보낸 사람: {}\n최근 대화:\n{}\n현재 메시지: {}",
        input.sender.trim(), context, text
    );
    let parsed = match ai_transport::json_response(&prompt, ai_transport::schedule_schema(), 700).await {
        Some(value) if value["is_schedule"].is_boolean() => value,
        _ => return Json(serde_json::json!({"is_schedule":false,"source":"unavailable","error":"AI_SCHEDULE_UNAVAILABLE"})),
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
async fn friends_for_user(
    State(app): State<App>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<PublicUser>>, StatusCode> {
    let data = app.data.read().await;
    if !data.users.iter().any(|user| user.id == id) {
        return Err(StatusCode::NOT_FOUND);
    }
    let friend_ids = data.friendships.iter().filter_map(|friendship| {
        if friendship.first_id == id { Some(friendship.second_id) }
        else if friendship.second_id == id { Some(friendship.first_id) }
        else { None }
    }).collect::<Vec<_>>();
    Ok(Json(data.users.iter().filter(|user| friend_ids.contains(&user.id)).map(|user| user_out(user.id, user.name.clone(), user.avatar_url.clone(), user.status_message.clone(), user.ai_intervention.clone())).collect()))
}
async fn incoming_friend_requests(
    State(app): State<App>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<FriendRequestOut>>, StatusCode> {
    let data = app.data.read().await;
    if !data.users.iter().any(|user| user.id == id) {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(Json(data.friend_requests.iter().filter(|request| request.to_id == id).filter_map(|request| {
        let user = data.users.iter().find(|user| user.id == request.from_id)?;
        Some(FriendRequestOut { id: request.id.clone(), user: user_out(user.id, user.name.clone(), user.avatar_url.clone(), user.status_message.clone(), user.ai_intervention.clone()) })
    }).collect()))
}
async fn create_friend_request(
    State(app): State<App>,
    Json(input): Json<FriendRequestInput>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut data = app.data.write().await;
    let target_phone = phone_hash(&input.phone);
    let target = data.users.iter().find(|user| user.phone_hash == target_phone).map(|user| user.id).ok_or(StatusCode::NOT_FOUND)?;
    if target == input.sender_id || !data.users.iter().any(|user| user.id == input.sender_id) {
        return Err(StatusCode::BAD_REQUEST);
    }
    if are_friends(&data.friendships, input.sender_id, target) || data.friend_requests.iter().any(|request| (request.from_id == input.sender_id && request.to_id == target) || (request.from_id == target && request.to_id == input.sender_id)) {
        return Err(StatusCode::CONFLICT);
    }
    data.friend_requests.push(FriendRequest { id: Uuid::new_v4().to_string(), from_id: input.sender_id, to_id: target });
    Ok(Json(serde_json::json!({"ok":true})))
}
async fn accept_friend_request(
    State(app): State<App>,
    Path((request_id, receiver_id)): Path<(String, Uuid)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut data = app.data.write().await;
    let index = data.friend_requests.iter().position(|request| request.id == request_id && request.to_id == receiver_id).ok_or(StatusCode::NOT_FOUND)?;
    let request = data.friend_requests.remove(index);
    if !are_friends(&data.friendships, request.from_id, request.to_id) {
        data.friendships.push(Friendship { first_id: request.from_id, second_id: request.to_id });
    }
    Ok(Json(serde_json::json!({"ok":true})))
}
async fn decline_friend_request(
    State(app): State<App>,
    Path((request_id, receiver_id)): Path<(String, Uuid)>,
) -> StatusCode {
    let mut data = app.data.write().await;
    let before = data.friend_requests.len();
    data.friend_requests.retain(|request| !(request.id == request_id && request.to_id == receiver_id));
    if data.friend_requests.len() < before { StatusCode::NO_CONTENT } else { StatusCode::NOT_FOUND }
}
async fn remove_friend(
    State(app): State<App>,
    Path((user_id, friend_id)): Path<(Uuid, Uuid)>,
) -> StatusCode {
    let mut data = app.data.write().await;
    let before = data.friendships.len();
    data.friendships.retain(|friendship| !((friendship.first_id == user_id && friendship.second_id == friend_id) || (friendship.first_id == friend_id && friendship.second_id == user_id)));
    if data.friendships.len() == before {
        return StatusCode::NOT_FOUND;
    }
    let user_id = user_id.to_string();
    let friend_id = friend_id.to_string();
    let removed_room_ids = data.rooms.iter().filter(|room| room.direct_key.is_some() && room.participant_ids.contains(&user_id) && room.participant_ids.contains(&friend_id)).map(|room| room.id.clone()).collect::<Vec<_>>();
    data.rooms.retain(|room| !removed_room_ids.contains(&room.id));
    data.messages.retain(|message| !removed_room_ids.contains(&message.room_id));
    StatusCode::NO_CONTENT
}
async fn leave_room(
    State(app): State<App>,
    Path((room_id, user_id)): Path<(String, Uuid)>,
) -> StatusCode {
    let mut data = app.data.write().await;
    let Some(index) = data.rooms.iter().position(|room| room.id == room_id && room.participant_ids.contains(&user_id.to_string())) else {
        return StatusCode::NOT_FOUND;
    };
    if data.rooms[index].direct_key.is_some() {
        data.rooms.remove(index);
        data.messages.retain(|message| message.room_id != room_id);
        return StatusCode::NO_CONTENT;
    }
    let name = data.users.iter().find(|user| user.id == user_id).map(|user| user.name.clone()).unwrap_or_default();
    let room = &mut data.rooms[index];
    room.participant_ids.retain(|member_id| member_id != &user_id.to_string());
    room.participant_names.retain(|member| member != &name);
    room.members = room.participant_ids.len().min(u8::MAX as usize) as u8;
    StatusCode::NO_CONTENT
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
    let owner_id = input.owner_id.as_deref().and_then(|id| Uuid::parse_str(id.trim()).ok());
    let mut participant_ids = input.member_ids.unwrap_or_default().into_iter().filter_map(|id| Uuid::parse_str(id.trim()).ok()).collect::<Vec<_>>();
    if let Some(owner_id) = owner_id {
        if !participant_ids.contains(&owner_id) {
            participant_ids.push(owner_id);
        }
    }
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
    if direct_key.is_some() {
        let Some(owner_id) = owner_id else { return Err(StatusCode::BAD_REQUEST) };
        let friend_ids = participant_ids.iter().copied().filter(|id| *id != owner_id).collect::<Vec<_>>();
        if friend_ids.len() != 1 || !are_friends(&data.friendships, owner_id, friend_ids[0]) {
            return Err(StatusCode::FORBIDDEN);
        }
    }
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
        participant_ids: participant_ids.into_iter().map(|id| id.to_string()).collect(),
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
async fn update_own_appointment(
    State(app): State<App>,
    Path((id, creator)): Path<(String, String)>,
    Json(input): Json<UpdateAppointment>,
) -> Result<Json<Appointment>, StatusCode> {
    if input.title.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut data = app.data.write().await;
    let appointment = data
        .appointments
        .iter_mut()
        .find(|appointment| appointment.id == id && appointment.creator == creator)
        .ok_or(StatusCode::NOT_FOUND)?;
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
async fn delete_own_appointment(
    State(app): State<App>,
    Path((id, creator)): Path<(String, String)>,
) -> StatusCode {
    let mut data = app.data.write().await;
    let Some(index) = data
        .appointments
        .iter()
        .position(|appointment| appointment.id == id && appointment.creator == creator)
    else {
        return StatusCode::NOT_FOUND;
    };
    data.appointments.remove(index);
    StatusCode::NO_CONTENT
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
            friend_requests: vec![],
            friendships: vec![],
        })),
    };
    let router = Router::new()
        .route("/api/health", get(health))
        .route("/api/auth/signup", post(signup))
        .route("/api/auth/login", post(login))
        .route("/api/users", get(users))
        .route("/api/users/{id}/preferences", patch(update_preferences))
        .route("/api/users/{id}/avatar", patch(update_avatar))
        .route("/api/users/{id}/status", patch(update_status))
        .route("/api/users/{id}", delete(delete_account))
        .route("/api/friends/{id}", get(friends_for_user))
        .route("/api/friends/{id}/requests", get(incoming_friend_requests))
        .route("/api/friend-requests", post(create_friend_request))
        .route("/api/friend-requests/{request_id}/accept/{receiver_id}", post(accept_friend_request))
        .route("/api/friend-requests/{request_id}/decline/{receiver_id}", delete(decline_friend_request))
        .route("/api/friends/{user_id}/remove/{friend_id}", delete(remove_friend))
        .route("/api/ai/check", post(ai_check))
        .route("/api/ai/rewrite", post(ai_rewrite))
        .route("/api/ai/schedule", post(ai_schedule))
        .route("/api/ai/support", post(ai_support))
        .route("/api/ai/reports", post(report_ai))
        .route("/api/bootstrap", get(bootstrap))
        .route("/api/rooms", post(create_room))
        .route("/api/rooms/{id}/members", post(invite_members))
        .route("/api/rooms/{room_id}/leave/{user_id}", delete(leave_room))
        .route("/api/agreements", post(create_agreement))
        .route("/api/appointments", post(create_appointment))
        // Keep the previous edit URL available too: a browser with an older
        // app.js can still save its form while it refreshes to the new UI.
        .route("/api/appointments/{id}", patch(update_appointment).delete(delete_appointment))
        .route("/api/appointments/{id}/creator/{creator}", patch(update_own_appointment).delete(delete_own_appointment))
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

