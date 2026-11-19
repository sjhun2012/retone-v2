mod ai_rules;
mod ai_transport;
mod rewrite;
mod sources;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    routing::{delete, get, patch, post},
};
use chrono::Utc;
use futures_util::stream::{self, Stream};
use password_hash::SaltString;
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{collections::HashMap, convert::Infallible, env, net::SocketAddr, sync::Arc};
use tokio::sync::{RwLock, broadcast};
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
    #[serde(skip_serializing_if = "Option::is_none")]
    sender_id: Option<Uuid>,
    mine: bool,
    body: String,
    created: i64,
    unread: u8,
    read_by: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_to: Option<ReplyPreview>,
    has_sources: bool,
    #[serde(skip_serializing)]
    source_query: Option<String>,
}
#[derive(Clone, Serialize)]
struct ReplyPreview {
    message_id: String,
    sender: String,
    body: String,
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
    source_cache: HashMap<String, sources::SourceInsight>,
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
    deletions: broadcast::Sender<(String, String)>,
}
#[derive(Deserialize)]
struct Send {
    sender: String,
    sender_id: Option<Uuid>,
    body: String,
    reply_to_id: Option<String>,
    source_query: Option<String>,
}
#[derive(Deserialize)]
struct SourceRequest {
    requester_id: Uuid,
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
    client_id: Option<Uuid>,
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
}
#[derive(Deserialize)]
struct ScheduleDetection {
    is_schedule: bool,
    title: String,
    fields: Vec<ScheduleFieldInput>,
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
fn built_in_test_users() -> Vec<DemoUser> {
    [
        (Uuid::from_u128(0x7265746f_6e65_0000_0000_000000000001), "신지훈", "01000000000"),
        (Uuid::from_u128(0x7265746f_6e65_0000_0000_000000000002), "바나나", "01011111111"),
    ]
    .into_iter()
    .map(|(id, name, phone)| {
        let salt = SaltString::generate(&mut OsRng);
        let password_hash = Argon2::default()
            .hash_password(b"111111", &salt)
            .expect("the built-in test password is valid")
            .to_string();
        DemoUser {
            id,
            phone_hash: phone_hash(phone),
            name: name.into(),
            password_hash,
            avatar_url: None,
            status_message: "테스트 계정".into(),
            ai_intervention: "standard".into(),
        }
    })
    .collect()
}

async fn ensure_test_users(db: Option<&PgPool>) -> Result<Vec<DemoUser>, sqlx::Error> {
    let mut users = built_in_test_users();
    if let Some(db) = db {
        for user in &mut users {
            user.id = sqlx::query_scalar(
                "INSERT INTO retone_v2.users(id,phone_hash,name,password_hash,is_admin,ai_intervention,status_message) \
                 VALUES($1,$2,$3,$4,FALSE,'standard','테스트 계정') \
                 ON CONFLICT(phone_hash) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash, \
                 ai_intervention='standard',status_message='테스트 계정',deleted_at=NULL RETURNING id"
            )
            .bind(user.id)
            .bind(&user.phone_hash)
            .bind(&user.name)
            .bind(&user.password_hash)
            .fetch_one(db)
            .await?;
        }
    }
    Ok(users)
}

#[cfg(test)]
mod shortcut_login_tests {
    use super::*;

    #[test]
    fn shortcut_accounts_match_the_buttons() {
        let users = built_in_test_users();
        for (user, name, phone) in [
            (&users[0], "신지훈", "01000000000"),
            (&users[1], "바나나", "01011111111"),
        ] {
            assert_eq!(user.name, name);
            assert_eq!(user.phone_hash, phone_hash(phone));
            let parsed = PasswordHash::new(&user.password_hash).unwrap();
            assert!(Argon2::default().verify_password(b"111111", &parsed).is_ok());
        }
    }
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
fn warns_about_current_message(text: &str, result: &serde_json::Value) -> bool {
    result["verdict"] == "WARN"
        && result["trigger"].as_str().is_some_and(|trigger| !trigger.trim().is_empty() && text.contains(trigger))
        && result["suggestion"].as_str().is_some_and(|suggestion| !suggestion.trim().is_empty())
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
    if level == "light" && attack.is_none() {
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"light"}),
        );
    }
    let hash = format!(
        "{:x}",
        Sha256::digest(format!("v8:{level}:{text}:{sender}:{context}").as_bytes())
    );
    if let Some(db) = &app.db {
        if let Ok(Some((verdict,suggestion,info_level,info_note,info_queries)))=sqlx::query_as::<_,(String,Option<String>,String,Option<String>,Vec<String>)>("SELECT verdict,suggestion,info_level,info_note,info_queries FROM retone_v2.ai_cache WHERE message_hash=$1").bind(&hash).fetch_optional(db).await{return Json(serde_json::json!({"verdict":verdict,"suggestion":suggestion,"info":{"level":info_level,"note":info_note,"queries":info_queries},"source":"cache"}));}
    }
    let Some(_key) = env::var("OPENAI_API_KEY").ok() else {
        if let Some((matched, source)) = attack {
            return Json(serde_json::json!({"verdict":"WARN","trigger":matched,"suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":source}));
        }
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"unavailable","error":"AI_CHECK_UNAVAILABLE"}),
        );
    };
    let local_trigger = attack.map(|(matched, _)| matched).unwrap_or("없음");
    let prompt = format!(
        "너는 Re:Tone의 전송 전 문장 편집자다. 지금 검사할 대상은 오직 '{sender}'가 작성한 현재 문장 하나다. 최근 대화는 뜻과 화자를 이해하는 참고 자료일 뿐이다. 최근 대화 속 다른 사람의 욕설·공격 때문에 현재 문장을 WARN하면 안 된다.\n1) 현재 문장 자체에 심한 욕설·위협·조롱·비꼼·압박이 있을 때만 WARN한다. 친한 사이의 가벼운 농담은 PASS한다. 서버가 현재 문장에서 찾은 표현은 '{local_trigger}'이다. '없음'이 아니면 WARN한다.\n2) WARN이면 trigger에 현재 문장에 실제로 연속해서 들어 있는 문제 표현을 그대로 짧게 복사한다. trigger를 현재 문장에서 정확히 복사할 수 없다면 PASS한다. PASS이면 trigger와 suggestion은 null이다.\n3) WARN의 suggestion은 설명이나 따옴표 없이 사용자가 바로 보낼 수 있는 다듬은 문장 하나다. 질문은 같은 정보를 묻는 질문으로, 요청·거절·유보는 같은 의도로 유지한다. 날짜·시각·수량·장소·담당자와 원문의 존댓말·반말을 보존한다. 맥락에 없는 사과·이유·감정·약속을 만들지 않는다. 상대의 능력·성격을 평가하거나 '이것도 못 해?', '왜 제대로 못 해?'처럼 비난하는 질문을 남기지 않는다. 원하는 행동과 이유를 구체적으로 말한다. 예를 들어 '씨발, 이것도 제대로 못 해? 오늘 4시까지 다시 해.'는 '이 부분이 제대로 되지 않아 답답해. 오늘 4시까지 다시 확인해 줘.'처럼 쓴다. 완성된 suggestion만 다시 검사해도 PASS가 되어야 한다.\n4) 현재 문장이 외부 자료로 확인 가능한 정보를 단정해서 알려주는 문장이면 info.queries에 그 주장 하나를 확인하기 좋은 짧은 한국어 검색어를 정확히 1개 넣는다. 과학·역사·제품 사양·통계·뉴스·제도 등은 포함한다. 질문, 의견, 감정, 인사, 개인 경험, 약속, 일정 제안, 명령·부탁, 수락·거절에는 검색어를 넣지 않는다. 최근 대화에만 있는 정보 때문에 검색어를 만들지 않는다.\n5) 그중 건강·안전·법·돈·정치·재난·통계·속보성 주장에 출처·날짜·원문이 빠졌다면 info.level=check로 둔다. 그 밖의 정보성 주장은 info.level=none으로 두되 검색어는 유지한다. 사실 여부를 판정하지 않는다. 정보 확인만 필요한 문장은 PASS다.\n6) 현재 개입 강도는 {level}이다. standard는 뚜렷한 경우만, careful은 비꼼·오해 가능성까지 본다.\nJSON만 출력: {{\"verdict\":\"PASS|WARN\",\"trigger\":string|null,\"suggestion\":string|null,\"info\":{{\"level\":\"none|check\",\"note\":string|null,\"queries\":[string]}}}}.\n최근 대화(참고만 함):\n{context}\n현재 문장({sender} 작성): {text}"
    );
    let parsed = match ai_transport::structured_response("gpt-4.1-mini", &prompt, None, ai_transport::check_schema(), 700).await {
        Some(value) if matches!(value["verdict"].as_str(), Some("PASS" | "WARN")) => value,
        _ => {
            if let Some((matched, source)) = attack {
                return Json(serde_json::json!({"verdict":"WARN","trigger":matched,"suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":source}));
            }
            return Json(serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"unavailable","error":"AI_CHECK_UNAVAILABLE"}));
        }
    };
    // Factual claims can be returned as WARN by the model even though there is
    // no person-directed attack. Keep the intervention as a source check.
    let source_check = ai_rules::unverified_sensitive_claim(text);
    let model_warn = warns_about_current_message(text, &parsed);
    let verdict = if source_check { "PASS" } else if attack.is_some() || model_warn { "WARN" } else { "PASS" };
    let suggestion = if verdict == "WARN" { parsed["suggestion"].as_str().filter(|value| !value.trim().is_empty()) } else { None };
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

#[cfg(test)]
mod ai_check_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_warning_must_quote_the_message_currently_being_sent() {
        let stale = json!({"verdict":"WARN","trigger":"병신","suggestion":"다음부터 조심해 줘."});
        assert!(!warns_about_current_message("알겠어. 다음부터 조심해 줘.", &stale));
        let current = json!({"verdict":"WARN","trigger":"병신","suggestion":"그렇게 말하면 속상해."});
        assert!(warns_about_current_message("너 진짜 병신이냐?", &current));
        let missing_edit = json!({"verdict":"WARN","trigger":"병신","suggestion":null});
        assert!(!warns_about_current_message("너 진짜 병신이냐?", &missing_edit));
    }
}

async fn ai_schedule(Json(input): Json<ScheduleCheck>) -> Json<serde_json::Value> {
    let text = input.text.trim();
    if ai_rules::schedule_reply_only(text) {
        return Json(serde_json::json!({"is_schedule":false,"source":"rules"}));
    }
    // Only the just-sent message is evidence of intent. Older clients can
    // send extra JSON keys; ScheduleCheck never forwards them to the model.
    let prompt = format!("아래 메시지 한 개의 작성자가 직접 새 만남이나 할 일을 제안·요청하는지 판정한다. \
        '만날래?', '야 내일 만날래?', '내일 카페에서 보자.', '이번 주말 같이 갈까?', '금요일까지 자료 보내줘'는 true다. \
        수락, 거절, 확인 질문, 이모지, 취소, 재촉, 단순 시간·장소 답변, 과거 회상, 남의 제안 인용은 false다. \
        예: '?', '그래, 좋아!', '내일은 좀 힘들어', '몇 시에?', '왜 안 와?', '친구가 내일 만나자고 했어'는 false다. \
        거절하거나 수락하며 다른 약속을 직접 제안하면 새 제안에 대해서만 true다. \
        true이면 짧은 제목과 할일·누구·언제·어디를 추출하고 명시된 세부사항만 추가한다. \
        추측할 수밖에 없는 항목은 빈 문자열로 둔다. false이면 제목을 비우고 fields를 빈 배열로 둔다.\n메시지(JSON 문자열): {}",
        serde_json::json!(text));
    let detection = ai_transport::json_response(&prompt, ai_transport::schedule_schema(), 700).await
        .and_then(|value| serde_json::from_value::<ScheduleDetection>(value).ok());
    Json(schedule_result(text, detection))
}

fn schedule_result(text: &str, detection: Option<ScheduleDetection>) -> serde_json::Value {
    use serde_json::json;
    let (title, proposed, source) = match detection {
        Some(result) if result.is_schedule => (result.title, result.fields, "ai"),
        Some(_) => return json!({"is_schedule":false,"source":"ai"}),
        None => {
            let Some(plan) = ai_rules::local_plan(text) else {
                return json!({"is_schedule":false,"source":"unavailable","error":"AI_SCHEDULE_UNAVAILABLE"});
            };
            let fields = [("할일", plan.task), ("누구", plan.who), ("언제", plan.when), ("어디", plan.place)]
                .into_iter().map(|(label, value)| ScheduleFieldInput { label: label.into(), value })
                .collect();
            ("새 일정".into(), fields, "rules")
        }
    };
    let mut fields: Vec<_> = ["할일", "누구", "언제", "어디"].into_iter().map(|label| {
        let value = proposed.iter().find(|field| field.label.trim() == label)
            .map(|field| field.value.trim()).unwrap_or_default();
        json!({"label":label,"value":value})
    }).collect();
    for field in proposed {
        let label = field.label.trim();
        if fields.len() == 12 { break; }
        if !label.is_empty() && !fields.iter().any(|f| f["label"] == label) {
            fields.push(json!({"label":label,"value":field.value.trim()}));
        }
    }
    let title = title.trim();
    json!({"is_schedule":true,"title":if title.is_empty() { "새 일정" } else { title },"fields":fields,"source":source})
}

#[cfg(test)]
mod schedule_tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn old_clients_cannot_turn_reactions_into_proposals_with_room_history() {
        for reply in ["?", "？？", "👍", "그래, 좋아!", "ㅇㅋ", "몇 시에?"] {
            let payload = json!({"text":reply,"sender":"바나나","context":["신지훈: 야 내일 만날래?"]});
            let input = serde_json::from_value(payload).unwrap();
            let Json(result) = ai_schedule(Json(input)).await;
            assert_eq!(result, json!({"is_schedule":false,"source":"rules"}), "{reply}");
        }
    }

    #[test]
    fn outage_can_still_suggest_an_explicit_meeting() {
        for proposal in ["야 내일 만날래?", "내일 카페에서 보자."] {
            let result = schedule_result(proposal, None);
            assert_eq!(result["is_schedule"], true);
            assert_eq!(result["source"], "rules");
            assert_eq!(result["fields"][2], json!({"label":"언제","value":"내일"}));
        }
        assert_eq!(schedule_result("?", None)["is_schedule"], false);
        assert_eq!(schedule_result("내일은 힘들어", None)["is_schedule"], false);
    }

    #[test]
    fn model_fields_keep_their_values_and_blank_fields_stay_blank() {
        let detection = serde_json::from_value(json!({
            "is_schedule":true,"title":"카페 약속","fields":[
                {"label":"어디","value":"카페"}, {"label":"준비물","value":"책"},
                {"label":"할일","value":"독서"}, {"label":"할일","value":"중복"}
            ]
        })).unwrap();
        let result = schedule_result("카페에서 같이 책 읽을래?", Some(detection));
        assert_eq!(result["fields"], json!([
            {"label":"할일","value":"독서"}, {"label":"누구","value":""},
            {"label":"언제","value":""}, {"label":"어디","value":"카페"},
            {"label":"준비물","value":"책"}
        ]));
    }
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
    let sender = match input.sender_id {
        Some(id) => rewrite::account_name(&app, id).await?,
        None => input.sender.trim().chars().take(24).collect::<String>(),
    };
    if sender.is_empty() || input.body.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut d = app.data.write().await;
    if let Some(id_of_sender) = input.sender_id {
        rewrite::require_member(&d, &id, id_of_sender)?;
    }
    let unread = d
        .rooms
        .iter()
        .find(|room| room.id == id)
        .map(|room| room.members.saturating_sub(1))
        .unwrap_or(0);
    let reply_to = match input.reply_to_id.as_deref() {
        Some(reply_id) => {
            let original = d.messages.iter().find(|message| message.id == reply_id && message.room_id == id)
                .ok_or(StatusCode::BAD_REQUEST)?;
            Some(ReplyPreview {
                message_id: original.id.clone(),
                sender: original.sender.clone(),
                body: original.body.chars().take(180).collect(),
            })
        }
        None => None,
    };
    let source_query = input.source_query.map(|query| query.trim().chars().take(180).collect::<String>())
        .filter(|query| !query.is_empty());
    let message = Message {
        id: Uuid::new_v4().to_string(),
        room_id: id.clone(),
        sender: sender.clone(),
        sender_id: input.sender_id,
        // A message is not intrinsically "mine": that depends on the person
        // currently looking at it. The browser compares the sender to its
        // signed-in user, so A's message is shown as incoming for B.
        mine: false,
        body: input.body.trim().to_string(),
        created: Utc::now().timestamp_millis(),
        unread,
        read_by: vec![sender],
        reply_to,
        has_sources: source_query.is_some(),
        source_query,
    };
    d.messages.push(message.clone());
    if let Some(room) = d.rooms.iter_mut().find(|r| r.id == id) {
        room.last = message.body.clone();
        room.updated = message.created;
    }
    Ok(Json(message))
}

async fn message_sources(
    State(app): State<App>,
    Path(message_id): Path<String>,
    Json(input): Json<SourceRequest>,
) -> Result<Json<sources::SourceInsight>, StatusCode> {
    let (claim, query, cached) = {
        let data = app.data.read().await;
        let message = data.messages.iter().find(|message| message.id == message_id).ok_or(StatusCode::NOT_FOUND)?;
        let room = data.rooms.iter().find(|room| room.id == message.room_id).ok_or(StatusCode::NOT_FOUND)?;
        if !room.participant_ids.contains(&input.requester_id.to_string()) { return Err(StatusCode::FORBIDDEN); }
        let query = message.source_query.clone().ok_or(StatusCode::NOT_FOUND)?;
        (message.body.clone(), query, data.source_cache.get(&message_id).cloned())
    };
    if let Some(result) = cached { return Ok(Json(result)); }
    let result = sources::search(&claim, &query).await.ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    app.data.write().await.source_cache.insert(message_id, result.clone());
    Ok(Json(result))
}
#[derive(Deserialize)]
struct RoomSubscriber {
    user_id: String,
}

async fn room_message_events(
    State(app): State<App>,
    Path(room_id): Path<String>,
    Query(user): Query<RoomSubscriber>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    let data = app.data.read().await;
    let room = data.rooms.iter().find(|room| room.id == room_id).ok_or(StatusCode::NOT_FOUND)?;
    if !room.participant_ids.contains(&user.user_id) {
        return Err(StatusCode::FORBIDDEN);
    }
    let receiver = app.deletions.subscribe();
    drop(data);
    let events = stream::unfold((receiver, room_id), |(mut receiver, room_id)| async move {
        loop {
            let event = match receiver.recv().await {
                Ok((room, message)) if room == room_id => Event::default().event("deleted").data(message),
                Ok(_) => continue,
                Err(broadcast::error::RecvError::Lagged(_)) => Event::default().event("resync").data(""),
                Err(broadcast::error::RecvError::Closed) => return None,
            };
            return Some((Ok(event), (receiver, room_id)));
        }
    });
    Ok(Sse::new(events).keep_alive(KeepAlive::default()))
}

async fn delete_message(
    State(app): State<App>,
    Path((room_id, message_id)): Path<(String, String)>,
) -> StatusCode {
    let mut d = app.data.write().await;
    let Some(index) = d.messages.iter().position(|m| m.room_id == room_id && m.id == message_id) else {
        return StatusCode::NOT_FOUND;
    };
    d.messages.remove(index);
    d.source_cache.remove(&message_id);
    let last = d.messages.iter().rev().find(|m| m.room_id == room_id)
        .map(|m| (m.body.clone(), m.created));
    if let Some(room) = d.rooms.iter_mut().find(|r| r.id == room_id) {
        if let Some((body, created)) = last {
            room.last = body;
            room.updated = created;
        } else {
            room.last = "새 대화를 시작해 보세요.".into();
        }
    }
    let _ = app.deletions.send((room_id, message_id));
    StatusCode::NO_CONTENT
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
    let NewAppointment { client_id, title, date, place, fields, creator, source_message_id, room_id } = input;
    let title = title.trim();
    if title.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let creator = creator.as_deref().unwrap_or("").trim().chars().take(24).collect::<String>();
    let source_message_id = source_message_id.as_deref().map(str::trim).filter(|id| !id.is_empty()).map(str::to_string);
    let fields = schedule_fields(fields.unwrap_or_else(|| default_schedule_fields(&creator, date.as_deref(), place.as_deref())));
    let mut data = app.data.write().await;
    let mut room_id = room_id.as_deref().map(str::trim).filter(|id| !id.is_empty()).map(str::to_string);
    let id = client_id.unwrap_or_else(Uuid::new_v4).to_string();
    if let Some(existing) = data.appointments.iter().find(|item| item.id == id ||
        (source_message_id.is_some() && item.source_message_id == source_message_id)) {
        if existing.creator != creator || existing.source_message_id != source_message_id ||
            (room_id.is_some() && existing.room_id != room_id) {
            return Err(StatusCode::CONFLICT);
        }
        return Ok(Json(existing.clone()));
    }
    if let Some(source_id) = &source_message_id {
        let source = data.messages.iter().find(|message| &message.id == source_id).ok_or(StatusCode::NOT_FOUND)?;
        if source.sender != creator || room_id.as_ref().is_some_and(|room| room != &source.room_id) {
            return Err(StatusCode::BAD_REQUEST);
        }
        room_id = Some(source.room_id.clone());
    }
    let appointment = Appointment { id, title: title.chars().take(80).collect(), fields, creator, source_message_id, room_id };
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
    let test_users = ensure_test_users(db.as_ref()).await.expect("test login accounts must be available");
    let test_friendships = vec![Friendship { first_id: test_users[0].id, second_id: test_users[1].id }];
    let app_state = App {
        db,
        deletions: broadcast::channel(256).0,
        data: Arc::new(RwLock::new(Data {
            users: test_users,
            rooms: vec![],
            messages: vec![],
            agreements: vec![],
            appointments: vec![],
            friend_requests: vec![],
            friendships: test_friendships,
            source_cache: HashMap::new(),
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
        .route("/api/ai/rewrite", post(rewrite::legacy))
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
        .route("/api/messages/{message_id}/sources", post(message_sources))
        .route("/api/rooms/{id}/rewrite", post(rewrite::in_room))
        .route("/api/rooms/{id}/message-events", get(room_message_events))
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

