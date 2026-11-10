"""Exercise contextual AI checks against a running Re:Tone service.

Usage: python tests/roleplay_live.py https://retone-v2-mygr.onrender.com
"""

import concurrent.futures
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


SCENARIOS = [
    ("첫 인사", ["민지: 안녕! 오늘 어땠어?", "준호: 정신없었지만 이제 좀 쉬어.", "민지: 고생했어. 저녁은 먹었어?"], "PASS", False),
    ("친한 사이의 농담", ["수아: 또 우산을 놓고 왔어.", "태오: 이번 주에 벌써 세 번째야.", "수아: 나 우산 수집가가 아니라 분실 전문가인가 봐 ㅋㅋ"], "PASS", False),
    ("직접적인 모욕", ["동료: 자료 검토해 줄 수 있어?", "나: 수정할 부분이 꽤 있네.", "동료: 너는 진짜 멍청해서 아무것도 제대로 못 하는구나."], "WARN", False),
    ("돌려 말한 위협", ["친구: 그 얘기는 다른 사람한테 하지 마.", "나: 이미 상담 선생님께 말씀드렸어.", "친구: 내일 학교에서 마주치면 후회하게 될 거야."], "WARN", False),
    ("사과와 책임 인정", ["친구: 어제 기다렸는데 연락이 없었어.", "나: 미안해. 내가 시간을 잘못 기억했어.", "나: 다음에는 늦기 전에 꼭 연락할게."], "PASS", False),
    ("거절과 경계", ["친구: 지금 통화할 수 있어?", "나: 오늘은 지쳐서 통화가 어려워.", "나: 내일 이야기해도 될까?"], "PASS", True),
    ("상처받은 마음 전달", ["친구: 농담이었어, 왜 그렇게 심각해?", "나: 그 말은 내게 좀 아팠어.", "나: 다음에는 그런 농담을 하지 않았으면 해."], "PASS", False),
    ("소문 전달", ["친구: 학교에 무슨 일 있었대?", "나: 단체 채팅에서 글을 봤어.", "나: 다음 주부터 학교가 한 달간 문을 닫는대. 공식 발표인지는 모르겠어."], "CHECK", False),
    ("건강 정보 단정", ["가족: 감기 기운이 있어서 쉬려고.", "나: 인터넷에서 글을 봤는데", "나: 이 약을 먹으면 모든 감기가 하루 만에 낫는대."], "CHECK", False),
    ("금융 정보 단정", ["친구: 투자 얘기가 많더라.", "나: 누가 링크를 보내줬어.", "나: 이 코인은 다음 달에 반드시 두 배가 된대."], "CHECK", False),
    ("법률 정보 단정", ["친구: 계약서에 서명하기 전에 확인해야겠어.", "나: 댓글에서 봤는데", "나: 미성년자가 서명한 계약은 무조건 다 무효래."], "CHECK", False),
    ("재난 정보 소문", ["친구: 밖에서 사이렌이 들려.", "나: 아직 공식 알림은 못 봤어.", "나: 우리 동네에 곧 대피 명령이 내려진대."], "CHECK", False),
    ("구체적인 만남 약속", ["민지: 주말에 시간 돼?", "준호: 토요일 오후면 돼.", "민지: 그럼 토요일 3시에 역 앞 카페에서 만나자."], "PASS", True),
    ("막연한 제안", ["친구: 방학에 뭐 할까?", "나: 아직 계획 없어.", "친구: 이번 방학에 같이 영화 보러 가자."], "PASS", True),
    ("약속 취소", ["친구: 토요일 영화 약속 기억하지?", "나: 응.", "친구: 미안, 토요일 영화는 취소해야겠어."], "PASS", False),
    ("기존 약속 재촉", ["나: 8시 30분에 만나기로 했잖아.", "친구: 지금 가고 있어.", "나: 왜 아직 안 와?"], "PASS", False),
    ("학교 과제 분담", ["팀원: 발표 자료가 아직 없어.", "나: 내가 디자인할게.", "팀원: 금요일까지 발표 자료 초안 만들어 줘."], "PASS", True),
    ("식사 약속", ["친구: 오랜만에 얼굴 보고 싶다.", "나: 이번 주는 목요일이 좋아.", "친구: 목요일 저녁에 같이 밥 먹자."], "PASS", True),
    ("몸 상태를 배려하는 답장", ["친구: 오늘 너무 피곤해서 밖에 못 나가겠어.", "나: 알겠어.", "나: 푹 쉬어. 답장은 천천히 해도 돼."], "PASS", False),
    ("외모 비하", ["친구: 오늘 사진 올렸어.", "나: 봤어.", "나: 너 외모는 정말 최악이야. 사진 올리지 마."], "WARN", False),
    ("빈정거림", ["팀원: 자료를 늦게 보냈어, 미안.", "나: 괜찮다고 하기 어렵네.", "나: 역시 네가 하면 기대를 안 하는 게 맞겠다."], "WARN", False),
    ("구체적인 피드백", ["팀원: 자료 어때?", "나: 표는 읽기 좋았어.", "나: 출처가 빠진 부분은 보완해 주면 좋겠어."], "PASS", False),
    ("합의된 장난", ["친구: 오늘도 내가 게임 이겼다!", "나: 인정 ㅋㅋ", "나: 다음 판은 내가 이긴다, 각오해!"], "PASS", False),
    ("개인정보 요구 거절", ["상대: 친구 전화번호 좀 알려 줘.", "나: 본인 허락을 받지 않았어.", "나: 번호는 내가 대신 전달할 수 없고 직접 물어봐 줘."], "PASS", False),
    ("정보 공개로 협박", ["상대: 그 사진 지워 줘.", "나: 왜?", "상대: 내 부탁 안 들어주면 네 주소를 온라인에 올릴 거야."], "WARN", False),
    ("가벼운 감탄사", ["친구: 시험 끝났다!", "나: 드디어.", "나: 와 진짜 미쳤다 ㅋㅋ 너무 좋아."], "PASS", False),
    ("오해 확인", ["친구: 내 메시지를 읽고 답이 없네.", "나: 내가 너무 바빴어.", "친구: 혹시 화난 거야?"], "PASS", False),
    ("일정이 아닌 회상", ["친구: 작년 여름 기억나?", "나: 물론이지.", "친구: 그때 토요일마다 도서관에서 만났었잖아."], "PASS", False),
    ("일정과 거친 표현 혼합", ["팀원: 발표 준비를 언제 할까?", "나: 내일 시간이 돼.", "팀원: 내일 5시에 모여. 안 나오면 가만 안 둔다."], "WARN", True),
    ("표현 수정 요청", ["친구: 네 말이 좀 차갑게 들렸어.", "나: 그렇게 들렸다면 미안해.", "나: 내가 걱정돼서 그랬어. 다시 차분히 이야기할게."], "PASS", False),
]


def post(base, route, payload):
    request = urllib.request.Request(
        base + route,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=50) as response:
        return json.load(response)


def run_one(index, scenario, base):
    title, turns, expected_check, expected_schedule = scenario
    context = turns[:-1]
    sender, text = turns[-1].split(": ", 1)
    payload = {"text": text, "context": context, "sender": sender}
    check = post(base, "/api/ai/check", {**payload, "ai_intervention": "standard"})
    schedule = post(base, "/api/ai/schedule", payload)
    check_outcome = "WARN" if check.get("verdict") == "WARN" else "CHECK" if check.get("info", {}).get("level") == "check" else "PASS"
    return {
        "number": index,
        "title": title,
        "turns": turns,
        "expected_check": expected_check,
        "expected_schedule": expected_schedule,
        "check": check,
        "check_outcome": check_outcome,
        "schedule": schedule,
    }


def main():
    base = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(run_one, i, scenario, base): i for i, scenario in enumerate(SCENARIOS, 1)}
        results = []
        for future in concurrent.futures.as_completed(futures):
            index = futures[future]
            try:
                results.append(future.result())
                print(f"{index:02d}/30 complete", flush=True)
            except Exception as error:
                results.append({"number": index, "title": SCENARIOS[index - 1][0], "error": str(error)})
                print(f"{index:02d}/30 error: {error}", flush=True)
    results.sort(key=lambda item: item["number"])
    check_matches = sum(item.get("check_outcome") == item.get("expected_check") for item in results)
    schedule_matches = sum(item.get("schedule", {}).get("is_schedule") == item.get("expected_schedule") for item in results)
    mismatches = [f"{item['number']:02d} {item['title']}" for item in results if "error" not in item and (item["check_outcome"] != item["expected_check"] or item["schedule"].get("is_schedule") != item["expected_schedule"])]
    output = Path("docs/roleplay-review-2026-11-10.md")
    output.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 30개 상황극 테스트",
        "",
        f"- 실행 시각: {datetime.now(timezone.utc).isoformat()}",
        f"- 대상: `{base}`",
        "- 표현 점검 강도: 앱 기본값인 `standard`",
        "- 각 상황에서 3턴의 가상 대화를 구성하고 마지막 발화와 앞선 대화를 AI 점검 및 일정 API에 전달했습니다.",
        "- 예상 결과는 검토 기준입니다. PASS는 무해한 발화, WARN은 공격·위협, CHECK는 출처 확인 제안을 뜻합니다.",
        f"- 표현 점검 일치: {check_matches}/30, 일정 인식 일치: {schedule_matches}/30, 요청 오류: {sum('error' in item for item in results)}",
        f"- 검토가 필요한 상황: {', '.join(mismatches) if mismatches else '없음'}",
        "",
    ]
    for item in results:
        lines += [f"## {item['number']:02d}. {item['title']}", ""]
        if "error" in item:
            lines += [f"- API 오류: `{item['error']}`", ""]
            continue
        for turn in item["turns"]:
            lines.append(f"- {turn}")
        check = item["check"]
        schedule = item["schedule"]
        lines += [
            f"- 표현 점검: 예상 `{item['expected_check']}` / 실제 `{item['check_outcome']}` (source: `{check.get('source')}`)",
            f"- 일정 인식: 예상 `{str(item['expected_schedule']).lower()}` / 실제 `{str(schedule.get('is_schedule')).lower()}` (source: `{schedule.get('source')}`)",
        ]
        if check.get("suggestion"):
            lines.append(f"- AI 제안: {check['suggestion']}")
        if check.get("info", {}).get("note"):
            lines.append(f"- 확인 안내: {check['info']['note']}")
        if schedule.get("is_schedule"):
            fields = schedule.get("fields", [])
            lines.append("- 추출한 일정: " + ", ".join(f"{field.get('label')}={field.get('value')}" for field in fields))
        lines.append("")
    output.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {output}")
    print(json.dumps({
        "total": len(results),
        "errors": sum("error" in item for item in results),
        "check_matches": check_matches,
        "schedule_matches": schedule_matches,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
