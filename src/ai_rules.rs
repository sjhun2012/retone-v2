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
    if ["너는", "넌", "네가", "니가"].iter().any(|s| t.contains(s)) && t.contains("멍청") { return Some("멍청"); }
    if [
        "가만안둬", "가만안둔다", "가만두지않", "죽여버", "죽여버릴",
        "찾아가서때", "패버", "반드시후회하게해줄", "후회하게만들어줄",
        "끝장내버릴", "다음엔끝장이야", "다음엔끝장이다", "찾아낼거야",
        "어디있는지찾아", "직접가서혼내줄", "다음에또그러면두고보",
    ].iter().any(|s| t.contains(s)) { return Some("위협"); }
    if ["무능한인간", "쓸모없는인간", "쓸모없어", "팀에서빠져", "이것도못하면서", "월급은꼬박", "네생각만하잖", "니생각만하잖"].iter().any(|s| t.contains(s)) { return Some("비난·비꼼"); }
    None
}

pub fn unverified_sensitive_claim(text: &str) -> bool {
    let t = compact(text);
    let domain = ["감기", "약을", "약이", "치료", "백신", "투자", "코인", "주식", "계약", "대피", "재난", "지진", "태풍"]
        .iter().any(|word| t.contains(word));
    let assertion = ["반드시", "무조건", "모든", "두배", "낫는대", "내려진대", "무효래", "오른대", "된다", "된대", "한대"]
        .iter().any(|word| t.contains(word)) || text.contains("100%");
    let addressed = ["너는", "네가", "니가", "넌", "당신", "너한테", "네게"]
        .iter().any(|word| t.contains(word));
    domain && assertion && !addressed
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
        return Some(if t.contains("꺼져") { "지금은 감정을 가라앉힐 시간이 필요해. 잠시 뒤에 이야기하자." } else if t.contains("생각만") { "내 의견도 함께 들어줬으면 좋겠어. 서로 생각을 차분히 이야기하자." } else if t.contains("멍청") { "지금 답답한 마음이 들어. 어떤 부분이 어려웠는지 차분히 이야기하고 싶어." } else { "지금 많이 답답해. 서로 존중하면서 차분히 이야기하고 싶어." }.into());
    }
    None
}

pub fn is_task(text: &str) -> bool {
    let t = compact(text);
    ["만나자", "만날래", "만납시다", "만나요", "놀자", "가자", "갑시다", "이야기해도될까", "만들어줘", "만들어주세요", "작성해줘", "작성해주세요", "정리해줘", "정리해주세요", "보내줘", "보내주세요", "제출해", "준비하자", "준비합시다", "준비할래", "회의하자", "회의합시다", "도와줄수있", "도와줘", "예약해줘", "확인해줘", "발표하자", "내자"].iter().any(|s| t.contains(s))
}
fn schedule_words(text: &str) -> String {
    text.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

fn is_schedule_letter(c: char) -> bool {
    // Keep medial vowels in decomposed Korean words eligible for AI review.
    c.is_alphabetic() && !matches!(c, '\u{3130}'..='\u{318f}' | '\u{1100}'..='\u{115f}' | '\u{11a8}'..='\u{11ff}')
}

pub fn schedule_reply_only(text: &str) -> bool {
    let words = schedule_words(text);
    // Punctuation, emoji, digits and isolated Hangul consonants/laughter
    // convey no actionable proposal on their own.
    if !words.chars().any(is_schedule_letter) {
        return true;
    }
    let t = words.trim_end_matches(['ㅋ', 'ㅎ', 'ㅠ', 'ㅜ']);
    [
        "응", "웅", "응응", "응좋아", "그래좋아", "좋아", "좋아요", "그래", "알겠어",
        "알겠습니다", "알겠어요", "좋습니다", "넵", "넵넵", "네", "네네", "네좋아요",
        "웅좋아", "응좋아요", "오케이좋아", "그때봐", "그렇구나", "뭐", "뭐야", "무슨뜻이야",
        "왜", "언제", "언제야", "몇시", "몇시에", "어디", "어디서", "누구랑",
        "ok", "okay", "yes", "no", "sure", "오케이", "콜", "좋지", "가능해", "맞아",
        "아니", "아니야", "아뇨", "안돼", "안될것같아", "못가", "다음에", "미안", "싫어",
        "취소", "취소할게", "약속취소",
        "응좋아내일보자", "좋아내일보자", "그래내일보자", "응내일보자", "그럼좋아",
        "그럼내일보자",
    ].contains(&t)
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
pub fn local_plan(text: &str) -> Option<Plan> {
    if schedule_reply_only(text) { return None; }
    if text.trim_end_matches([' ', '.', '?', '!']).ends_with(['"', '\'', '”', '’', '」']) {
        return None;
    }
    // A declined first date must not enter the draft for a later counteroffer.
    // A final cancellation also supersedes an earlier proposal.
    let text = text.rsplit(['.', '!', '?', '。', '！', '？', '\n'])
        .map(str::trim).find(|part| part.chars().any(is_schedule_letter))?;
    if text.starts_with(['"', '\'', '“', '‘', '「']) || text.ends_with(['"', '\'', '”', '’', '」']) {
        return None;
    }
    let t = schedule_words(text);
    // During an AI outage accept direct proposals and requests only. Match
    // sentence endings so reporting someone else's invitation is not a plan.
    let t = t.trim_end_matches(['ㅋ', 'ㅎ']);
    if ["두고보자", "지켜보자", "알아보자", "어디보자",
        "취소하자", "취소해줘", "취소해주세요"].iter().any(|phrase| t.ends_with(phrase)) {
        return None;
    }
    let date = when(text);
    let location = place(text);
    let affirmative = |ending: &&str| t.strip_suffix(*ending)
        .is_some_and(|prefix| !prefix.ends_with(['안', '못']));
    let direct_request = ["만나자", "만날래", "만날래요", "만날까", "만날까요", "만나실래요", "만나요", "만납시다",
        "놀자", "가자", "갑시다", "밥먹자", "식사하자", "공부하자", "공부할래", "모이자",
        "이야기해도될까", "만들어줘", "만들어주세요", "작성해줘", "작성해주세요",
        "정리해줘", "정리해주세요", "보내줘", "보내주세요", "제출해", "준비하자",
        "준비합시다", "준비할래", "회의하자", "회의합시다", "도와줄수있어",
        "도와줘", "예약해줘", "확인해줘", "발표하자", "내자"]
        .iter().any(affirmative);
    let meeting = ["보자", "볼래", "볼까", "볼까요", "갈래", "갈까", "갈까요", "가실래요", "먹을래", "먹을까", "먹을까요", "봐요"]
        .iter().any(affirmative)
        && (!date.is_empty() || !location.is_empty() || t.contains("같이"));
    if !direct_request && !meeting { return None; }
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
        for text in ["너처럼 무능한 인간은 팀에서 빠져", "이것도 못하면서 월급은 꼬박 받네", "한 번만 더 그러면 가만 안 둔다", "두고 봐, 반드시 후회하게 해줄게", "이번엔 넘어가지만 다음엔 끝장이야", "네가 어디 있는지 찾아낼 거야", "내가 직접 가서 혼내줄게", "다음에 또 그러면 두고 보자", "너는 맨날 네 생각만 하잖아", "너는 정말 멍청해서 아무것도 못하네"] { assert!(hostility(text).is_some(), "{text}"); }
        for text in ["많이 서운했어", "내 의견은 달라", "그 결과에 동의하기 어려워", "내가 멍청했네"] { assert_eq!(hostility(text), None); }
    }
    #[test] fn requests_and_non_plans() {
        for text in ["만날래?", "야 내일 만날래?", "내일 카페에서 보자.", "피피티 만들어줘", "민수야 금요일 오후 5시까지 보고서 작성해줘", "회의 자료 정리해서 보내주세요", "혹시 발표 자료 좀 도와줄 수 있어?", "우리 주말에 영화 보러 가자", "내일까지 광합성 발표 자료를 만들어줘", "내일 오후 3시에 회의실에서 발표 준비하자", "다음 주 월요일 오전 10시에 회의합시다", "내일 이야기해도 될까?", "좋아! 다음 주에는 등산 가자", "내일은 힘들어. 금요일에 만나자"] { assert!(local_plan(text).is_some(), "{text}"); }
        for text in ["안녕", "과학 발표 주제로 벤포드 법칙은 어때?", "물은 수소와 산소로 이루어져 있어", "왜 안 와? 지금 8시 30분이잖아", "어제 오후 3시에 회의했어", "응 좋아 내일 보자", "그래, 좋아!", "그래 좋아", "좋아. 내일 보자!", "내일 비가 오면 회의를 취소할 수도 있어", "내일은 안 만날래", "나는 안 갈래!", "내일은 안 보자", "비가 오니까 약속 취소하자", "내일 만나자고 했대", "내일 두고 보자", "내일은 카페에서?", "오후 5시에"] { assert!(local_plan(text).is_none(), "{text}"); }
    }
    #[test] fn extracts_only_explicit_fields() {
        let plan = local_plan("내일 오후 3시에 카페에서 보자.").unwrap();
        assert_eq!(plan.when, "내일 오후 3시에"); assert_eq!(plan.place, "카페");
        let plan = local_plan("내일은 카페에서 못 봐. 금요일에 도서관에서 볼까요? 😊").unwrap();
        assert_eq!(plan.when, "금요일에"); assert_eq!(plan.place, "도서관");
        for text in ["카페에서 만나자. 아, 내일 약속은 취소할게!", "“내일 만날래?”", "마지막 문장은 ‘내일 만날래?’",
            "내일은 안 갈까요?", "저녁에 안 먹을까요?",
            "작년에 카페에서 만나기로 했었지?", "친구가 ‘내일 만나자’고 했어"] {
            assert!(local_plan(text).is_none(), "{text}");
        }
        let plan = local_plan("피피티 만들어줘").unwrap();
        assert_eq!((plan.who, plan.when, plan.place), (String::new(), String::new(), String::new()));
    }
    #[test] fn reactions_never_invoke_schedule_ai() {
        for text in ["", "?", "?!?", "？？", "…", "👍🏽", "🙆‍♀️", "ㅋㅋㅋ", "ᄏᄏ", "ㅇㅋ", "응👍", "좋아요ㅎㅎ", "그래, 좋아!", "그래 좋아", "좋아. 내일 보자!", "응 좋아 내일 보자", "몇 시에?", "어디서?", "ok!", "아니"] {
            assert!(schedule_reply_only(text), "{text}");
        }
        for text in ["내일 만날래?", "내일 만날래?", "우리 주말에 영화 보러 가자", "금요일까지 보고서 작성해줘", "좋아, 그럼 목요일에 카페에서 보자", "내일 저녁 치맥 어때?"] {
            assert!(!schedule_reply_only(text), "{text}");
        }
    }
    #[test] fn rewrites_preserve_request() {
        assert!(rewrite_fallback("너 진짜 병신이냐?", "").is_some());
        assert!(rewrite_fallback("씨발! 내일 3시까지 피피티 만들어줘", "").unwrap().contains("내일 3시까지"));
        let rewritten = rewrite_fallback("너는 정말 멍청해서 아무것도 못하네", "나: 안녕, 오늘 어땠어?").unwrap();
        assert!(rewritten.contains("답답한 마음"));
        assert!(!rewritten.contains("안녕"));
    }
    #[test] fn sensitive_claims_are_not_interpersonal_attacks() {
        for text in ["이 약을 먹으면 모든 감기가 하루 만에 낫는대", "이 코인은 다음 달에 반드시 두 배가 된대", "미성년자가 서명한 계약은 무조건 다 무효래", "우리 동네에 곧 대피 명령이 내려진대"] {
            assert!(unverified_sensitive_claim(text), "{text}");
        }
        for text in ["약속은 반드시 지키자", "코인 지갑을 잃어버렸어", "너는 이 코인 얘기만 하면서 사람을 무시해"] {
            assert!(!unverified_sensitive_claim(text), "{text}");
        }
    }
}
