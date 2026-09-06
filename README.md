# 📚 Paper Studio Remote

논문 분류 스튜디오의 **정적 스냅샷 모바일 앱** — 원본 PC가 꺼져 있어도 고정 주소에서 열람.

**https://heungrae.github.io/papers-remote/**

## 내용

- 논문 93,428편 · 분류 노드 10,327개 (L1–L4 계층)
- 한국어 심층 해설(①비유 ②원리 ③수식 ④용어) 100% 커버리지
- 제목 검색 · 분류 트리 탐색 · 논문 상세(해설/초록/키워드/OA PDF 링크)
- PWA — 브라우저 "홈 화면에 추가"로 앱처럼 사용, 열람 데이터 오프라인 캐시

## 구조

```
index.html / app.js / style.css   SPA 셸 (해시 라우팅, 프레임워크 없음)
sw.js / manifest.webmanifest      PWA (앱셸 network-first, 데이터 cache-first)
data/
  meta.json                       빌드 시각·총계
  taxonomy.json                   분류 트리
  index/idx_{0..7}.json           검색 인덱스 (lazy load, 최초 1회)
  papers/p_{0000..1023}.json      상세 샤드 (FNV-1a(paper_id) % 1024)
```

## 갱신 (자동)

원본 PC cron이 **매일 07:00** `papers/tools/_deploy_remote_app.py`를 실행:
DB 내용 시그니처(논문/분류/해설/초록 카운트)가 마지막 배포와 다르면
`_build_remote_app.py`로 `data/` 재생성 → 자동 commit & push → Pages 재빌드.
변화가 없으면 아무것도 하지 않는다. 수동 갱신도 같은 스크립트를 실행하면 된다.

> 데이터 출처: 로컬 `papers_db.sqlite` 스냅샷. 해설 내 "(원문 확인 필요)" 표기는
> DB의 분류/초록 메타데이터가 실제 저작과 다를 수 있음을 의미한다.
