"""
Flaude Agent Runner Prototype
Claude Code CLI subprocess로 에이전트 실행이 되는지 검증.

테스트 항목:
1. claude -p 로 기본 실행
2. --system-prompt 로 instructions 전달
3. --allowedTools 로 도구 제한
4. --session-id 로 세션 생성
5. --resume 로 세션 재개
6. --permission-mode bypassPermissions 로 자동 실행
"""

import subprocess
import uuid
import json
import sys


def run_agent(prompt: str, instructions: str, tools: str | None = None,
              session_id: str | None = None, resume: str | None = None) -> str:
    """Claude Code CLI subprocess로 에이전트 실행"""
    cmd = ["claude", "-p", prompt, "--model", "opus"]

    if instructions:
        cmd.extend(["--system-prompt", instructions])

    if tools:
        cmd.extend(["--allowedTools", tools])

    if session_id:
        cmd.extend(["--session-id", session_id])

    if resume:
        cmd.extend(["--resume", resume])

    cmd.extend(["--permission-mode", "bypassPermissions"])

    print(f"\n{'='*60}")
    print(f"CMD: {' '.join(cmd[:6])}...")
    print(f"{'='*60}")

    env = {k: v for k, v in __import__('os').environ.items() if k != 'CLAUDECODE'}

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=120,
        env=env,
    )

    if result.returncode != 0:
        print(f"STDERR: {result.stderr[:500]}")
        return f"ERROR: {result.stderr[:500]}"

    return result.stdout.strip()


def test_1_basic():
    """테스트 1: 기본 실행"""
    print("\n[TEST 1] 기본 실행")
    result = run_agent(
        prompt="1+1은 몇이야? 숫자만 답해.",
        instructions="당신은 수학 계산기입니다. 숫자만 답하세요.",
    )
    print(f"결과: {result[:200]}")
    return "2" in result


def test_2_instructions():
    """테스트 2: instructions로 에이전트 성격 제어"""
    print("\n[TEST 2] instructions 제어")
    result = run_agent(
        prompt="안녕하세요",
        instructions="당신은 '수현'이라는 이름의 시장 조사 전문가입니다. 항상 자기소개를 '수현입니다'로 시작하세요. 한 문장만 답하세요.",
    )
    print(f"결과: {result[:200]}")
    return "수현" in result


def test_3_tools():
    """테스트 3: allowedTools로 도구 제한"""
    print("\n[TEST 3] 도구 제한")
    result = run_agent(
        prompt="현재 디렉토리에 어떤 파일이 있는지 알려줘. 간단히.",
        instructions="파일 목록을 확인하세요.",
        tools="Read",  # Bash 제외, Read만 허용
    )
    print(f"결과: {result[:200]}")
    return len(result) > 0


def test_4_session():
    """테스트 4: session-id로 세션 생성 + resume으로 재개"""
    print("\n[TEST 4] 세션 생성 + 재개")
    sid = str(uuid.uuid4())
    print(f"Session ID: {sid}")

    # 첫 질문
    result1 = run_agent(
        prompt="내 이름은 승현이야. 기억해. '기억했습니다'라고만 답해.",
        instructions="사용자가 말하는 것을 기억하세요.",
        session_id=sid,
    )
    print(f"첫 질문 결과: {result1[:200]}")

    # 후속 질문 (resume)
    result2 = run_agent(
        prompt="내 이름이 뭐라고 했지? 이름만 답해.",
        instructions="사용자가 말하는 것을 기억하세요.",
        resume=sid,
    )
    print(f"후속 질문 결과: {result2[:200]}")

    return "승현" in result2


if __name__ == "__main__":
    tests = [
        ("기본 실행", test_1_basic),
        ("instructions 제어", test_2_instructions),
        ("도구 제한", test_3_tools),
        ("세션 생성 + 재개", test_4_session),
    ]

    if len(sys.argv) > 1:
        # 특정 테스트만 실행: python test_agent_runner.py 1
        idx = int(sys.argv[1]) - 1
        name, fn = tests[idx]
        passed = fn()
        print(f"\n{'✅' if passed else '❌'} {name}")
    else:
        # 전체 실행
        results = []
        for name, fn in tests:
            try:
                passed = fn()
            except Exception as e:
                print(f"ERROR: {e}")
                passed = False
            results.append((name, passed))

        print(f"\n{'='*60}")
        print("결과 요약")
        print(f"{'='*60}")
        for name, passed in results:
            print(f"  {'✅' if passed else '❌'} {name}")
        print(f"\n{sum(1 for _, p in results if p)}/{len(results)} passed")
