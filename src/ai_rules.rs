//! Conservative local rules used when external AI is unavailable.
//! Keep word boundaries: concatenating entire sentences creates false positives
//! such as "혹시 발표" -> "혹시발표".
pub fn compact(text: &str) -> String {
    text.to_lowercase().chars().filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation()).collect()
}

pub fn strong_expression(text: &str) -> Option<&'static str> {
    let lower = text.to_lowercase();
    let educational = [
        "단어의 뜻", "표현의 뜻", "욕설의 뜻", "비속어의 뜻", "무슨 뜻",
        "무슨 의미", "욕설인지", "욕인지", "비속어인지", "표현인지",
        "말은 쓰면 안", "말을 쓰면 안", "표현을 쓰면 안", "욕설을 사용하지",
    ].iter().any(|s| lower.contains(s));
    if educational { return None; }
    let words: Vec<String> = lower.split(|c: char| !c.is_alphanumeric() && !(('\u{3131}'..='\u{318e}').contains(&c))).filter(|s| !s.is_empty()).map(str::to_string).collect();
    let bad = ["시발", "씨발", "시ㅂ", "ㅅㅂ", "ㅆㅂ", "개새끼", "개새", "병신", "븅신", "ㅂㅅ", "ㅄ", "좆", "ㅈㄴ", "존나", "미친놈", "미친년", "꺼져", "죽어", "죽인다", "뒤져", "닥쳐", "엿먹어", "새끼", "년아", "놈아", "씹", "지랄", "ㅈㄹ", "ㅁㅊ", "fuck", "shit", "bitch", "asshole"];
    // Only merge standalone single-character obfuscation tokens, never words.
    let mut candidates = words.clone();
    for i in 0..words.len() {
        if words[i].chars().count() != 1 { continue; }
        let mut joined = words[i].clone();
        for next in words.iter().skip(i+1).take(3) {
            joined.push_str(next);
            candidates.push(joined.clone());
            if next.chars().count() != 1 { break; }
        }
    }
    for term in bad {
        if candidates.iter().any(|word| {
            if term.is_ascii() { word == term || word == &format!("{term}ing") }
            else if term == "시발" { word.starts_with(term) } // 시발점 is handled below.
            else { word.contains(term) }
        }) && !(term == "시발" && candidates.iter().all(|w| !w.starts_with("시발") || w.starts_with("시발점"))) { return Some(term); }
    }
    None
}

pub fn hostility(text: &str) -> Option<&'static str> {
    let t = compact(text);
    if [
        "가만안둬", "가만안둔다", "가만두지않", "죽여버", "죽여버릴",
        "찾아가서때", "패버", "반드시후회하게해줄", "후회하게만들어줄",
        "끝장내버릴", "다음엔끝장이야", "다음엔끝장이다", "찾아낼거야",
        "어디있는지찾아", "직접가서혼내줄", "다음에또그러면두고보",
    ].iter().any(|s| t.contains(s)) { return Some("위협"); }
    if ["무능한인간", "쓸모없는인간", "쓸모없어", "팀에서빠져", "이것도못하면서", "월급은꼬박", "네생각만하잖", "니생각만하잖"].iter().any(|s| t.contains(s)) { return Some("비난·비꼼"); }
    None
}

pub fn rewrite_fallback(text: &str, context: &str) -> Option<String> {
    let t = compact(text);
    if ["알빠야", "내알바야", "니상관아니야", "네상관아니야"].iter().any(|s| t.contains(s)) && context.contains("[상대]") && ["왜안와", "늦었", "기다렸"].iter().any(|s| compact(context).contains(s)) {
        return Some("늦어서 미안해. 다음에는 미리 연락할게.".into());
    }
    if strong_expression(text).is_some() || hostility(text).is_some() {
        // Do not invent another person's actions or a deadline. Keep an explicit
        // request/question when possible and remove the attacking clause.
        if let Some((_, request)) = text.rsplit_once(['.', '!', '?']) {
            let request = request.trim();
            if !request.is_empty() && is_task(request) && strong_expression(request).is_none() && hostility(request).is_none() {
                return Some(format!("지금은 조금 답답해. {request}"));
            }
        }
        return Some(if t.contains("꺼져") { "지금은 감정을 가라앉힐 시간이 필요해. 잠시 뒤에 이야기하자." } else if t.contains("생각만") { "내 의견도 함께 들어줬으면 좋겠어. 서로 생각을 차분히 이야기하자." } else { "지금 많이 답답해. 서로 존중하면서 차분히 이야기하고 싶어." }.into());
    }
    None
}

pub fn is_task(text: &str) -> bool {
    let t = compact(text);
    ["만나자", "만날래", "만납시다", "만나요", "놀자", "가자", "갑시다", "이야기해도될까", "만들어줘", "만들어주세요", "작성해줘", "작성해주세요", "정리해줘", "정리해주세요", "보내줘", "보내주세요", "제출해", "준비하자", "준비합시다", "준비할래", "회의하자", "회의합시다", "도와줄수있", "도와줘", "예약해줘", "확인해줘", "발표하자", "내자"].iter().any(|s| t.contains(s))
}
pub fn schedule_negative(text: &str) -> bool {
    let t = compact(text);
    if ["응", "응좋아", "좋아", "그래", "알겠어", "넵", "네", "ㅇㅋ", "ㅇㅇ", "ok", "오케이", "응좋아내일보자"].contains(&t.as_str()) { return true; }
    if ["어제", "지난주", "했어", "했어요", "끝났어", "가정하면", "수도있", "취소", "안만나", "가지말자"].iter().any(|s| t.contains(s)) && !is_task(text) { return true; }
    if ["왜안와", "빨리와", "언제와", "지금와"].iter().any(|s| t.contains(s)) && !is_task(text) { return true; }
    false
}

#[derive(Debug, PartialEq)]
pub struct Plan { pub task: String, pub who: String, pub when: String, pub place: String }
fn when(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    let hints = ["내일", "모레", "오늘", "다음주", "이번주", "주말", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일", "오전", "오후", "저녁", "아침", "점심"];
    words.iter().enumerate().filter_map(|(i, w)| {
        let numeric = w.chars().next().is_some_and(|c| c.is_ascii_digit()) && ["시", "분", "월", "일"].iter().any(|s| w.contains(s));
        if hints.iter().any(|s| w.contains(s)) || numeric || (*w == "다음" && words.get(i+1).is_some_and(|x| x.starts_with('주'))) || (w.starts_with('주') && i>0 && words[i-1] == "다음") { Some(*w) } else { None }
    }).collect::<Vec<_>>().join(" ")
}
fn place(text: &str) -> String {
    text.split_whitespace().find_map(|w| w.strip_suffix("에서").filter(|s| !s.is_empty())).unwrap_or("").to_string()
}
pub fn local_plan(text: &str, context: &[String]) -> Option<Plan> {
    if schedule_negative(text) || !is_task(text) { return None; }
    let t = compact(text);
    let mut date = when(text);
    let mut location = place(text);
    // Inherit only fields explicitly referred to in this message, from the
    // most recent plan, never from an unrelated old conversation.
    if t.contains("거기") || t.contains("그때") || t.contains("그럼") {
        if let Some(previous) = context.iter().rev().find(|s| s.as_str() != text && is_task(s)) {
            if date.is_empty() || (t.contains("그럼") && !["내일", "오늘", "모레", "요일", "주말"].iter().any(|s| date.contains(s))) {
                let earlier = when(previous);
                let day = earlier.split_whitespace().filter(|w| !w.contains('시') && !w.contains('분') && !w.contains("오전") && !w.contains("오후")).collect::<Vec<_>>().join(" ");
                date = format!("{day} {date}").trim().to_string();
            }
            if location.is_empty() && t.contains("거기") { location = place(previous); }
        }
    }
    let who = text.split_whitespace().next().filter(|w| w.trim_end_matches(',').ends_with('야') || w.trim_end_matches(',').ends_with("님")).map(|w| w.trim_end_matches(',').trim_end_matches('야').to_string()).unwrap_or_default();
    let task = if t == "피피티만들어줘" || t == "ppt만들어줘" { "피피티 만들기".to_string() } else { text.trim().to_string() };
    Some(Plan { task, who, when: date, place: location })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn boundaries_and_obfuscation() {
        for text in ["혹시 발표 자료 좀 도와줄 수 있어?", "시발점에서 출발하자", "이것은 bullshitake 버섯", "욕설인 병신이라는 말은 쓰면 안 돼", "병신이라는 단어의 뜻을 설명해줘", "시발은 무슨 의미야?", "이 표현이 욕설인지 궁금해"] { assert_eq!(strong_expression(text), None, "{text}"); }
        for text in ["너 진짜 병신이냐?", "씨발 꺼져", "ㅅㅂ 너 뭐하냐 ㅂㅅ아", "시 발 너 진짜 병 신이네", "fuck you"] { assert!(strong_expression(text).is_some(), "{text}"); }
    }
    #[test] fn attacks_and_emotions() {
        for text in ["너처럼 무능한 인간은 팀에서 빠져", "이것도 못하면서 월급은 꼬박 받네", "한 번만 더 그러면 가만 안 둔다", "두고 봐, 반드시 후회하게 해줄게", "이번엔 넘어가지만 다음엔 끝장이야", "네가 어디 있는지 찾아낼 거야", "내가 직접 가서 혼내줄게", "다음에 또 그러면 두고 보자", "너는 맨날 네 생각만 하잖아"] { assert!(hostility(text).is_some(), "{text}"); }
        for text in ["많이 서운했어", "내 의견은 달라", "그 결과에 동의하기 어려워"] { assert_eq!(hostility(text), None); }
    }
    #[test] fn requests_and_non_plans() {
        for text in ["피피티 만들어줘", "민수야 금요일 오후 5시까지 보고서 작성해줘", "회의 자료 정리해서 보내주세요", "혹시 발표 자료 좀 도와줄 수 있어?", "우리 주말에 영화 보러 가자", "내일까지 광합성 발표 자료를 만들어줘", "내일 오후 3시에 회의실에서 발표 준비하자", "다음 주 월요일 오전 10시에 회의합시다", "내일 이야기해도 될까?"] { assert!(local_plan(text, &[]).is_some(), "{text}"); }
        for text in ["안녕", "과학 발표 주제로 벤포드 법칙은 어때?", "물은 수소와 산소로 이루어져 있어", "왜 안 와? 지금 8시 30분이잖아", "어제 오후 3시에 회의했어", "응 좋아 내일 보자", "내일 비가 오면 회의를 취소할 수도 있어"] { assert!(local_plan(text, &[]).is_none(), "{text}"); }
    }
    #[test] fn context_fields_and_no_invention() {
        let plan = local_plan("그럼 3시에 거기서 만나자", &["민수: 내일 도서관에서 발표 준비할래?".into()]).unwrap();
        assert_eq!(plan.when, "내일 3시에"); assert_eq!(plan.place, "도서관");
        let plan = local_plan("피피티 만들어줘", &[]).unwrap();
        assert_eq!((plan.who, plan.when, plan.place), (String::new(), String::new(), String::new()));
    }
    #[test] fn rewrites_preserve_request() {
        assert!(rewrite_fallback("너 진짜 병신이냐?", "").is_some());
        assert!(rewrite_fallback("씨발! 내일 3시까지 피피티 만들어줘", "").unwrap().contains("내일 3시까지"));
    }
}
