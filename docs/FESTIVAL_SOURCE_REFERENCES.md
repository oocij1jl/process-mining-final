# Festival 운영 조사 — 출처와 활용

조사 일자: 2026-11-28 (웹 검색과 웹 페이지 조회). 아래 표의 '확인한 사실'은 페이지에서 직접 확인한 내용만 적었다. 다른 페이지나 기억에서 가져온 내용은 넣지 않았다.

## 1. 출처별 확인 사실과 설계 활용

| # | 자료 | URL | 확인한 사실 | 설계 활용 |
|---|---|---|---|---|
| S1 | Fuji Rock Festival '25 관람객 안내 | https://25.en.fujirockfestival.com/news/0718e/index.htm | 종이 티켓은 현장 Wristband Exchange에서 손목밴드로 교환한 뒤 입장 게이트로 간다. 손목밴드를 제거하면 재입장할 수 없다. 분실 시 재발급하지 않는다. | 재입장 attempt의 `Wristband Check`, 훼손 시 `Entry Rejected(wristband_tampered)` |
| S2 | Fuji Rock '22 시설 안내 | https://en.fujirockfestival.com/2022/?p=27 | 입장 게이트 구역에 Bag Check와 Wristband Check 지점이 있다(당시 체온 측정·소독 포함). | 입구 프로세스에 `Security Check`와 `Wristband Check` 포함 |
| S3 | FUJI ROCK FESTIVAL'25 e+ 티켓 안내 | https://ib.eplus.jp/fujirock2025 | 3일권 소지자는 매일 05:00에 퇴장해야 하고 09:00 전에는 재입장할 수 없다. | D2에 손목밴드 보유(다일권) 재입장 비중을 높게 설정(37%) [가정] |
| S4 | Fuji Rock 손목밴드 교환 안내(’19) | https://en.fujirockfestival.com/2019/?p=514 | 개장 직전 Wristband Exchange가 매우 혼잡해질 수 있다. 일찍 오라고 권한다. | 개장 직후 도착 집중(D1·D2 12:00–12:15 가중치 최대) [가정] |
| S5 | 경향신문 2026-07-30 (펜타포트) | https://www.khan.co.kr/article/202607300957001 | 2026 인천펜타포트는 송도달빛축제공원에서 3일간 열리며 66개 팀이 참여한다. 무더위 속 장시간 대기를 줄이려고 입장 동선을 2곳으로 이원화했다. | 입장 대기를 핵심 문제로 설정, 보조 입구 1곳(North Gate)을 분석 단위로 설정 |
| S6 | Trip.com 블로그: 2026 펜타포트 안내 | https://kr.trip.com/blog/incheon-festival/ | 입장 시 신분증과 본인 모바일 티켓을 제시해야 하고 캡처본은 불가하다. 모바일 티켓과 입장 팔찌는 예매자 본인만 수령할 수 있다. | 첫 입장 `Ticket Verification` = QR 스캔 + 신분증 확인 + 팔찌 부착(서비스 시간이 김) [모델] |
| S7 | Korea Times 2024-08-04 | https://www.koreatimes.co.kr/amp/entertainment/music/20240804/pentaport-music-festival-organizers-warn-fans-against-overnight-queuing-waitlists | 주최 측이 관객 안전을 위해 밤샘 대기와 자체 대기명단 작성을 금지했다. | 대기열은 개장 시각 이후 형성된다고 가정(관측 시작 12:00) |
| S8 | 파이낸셜뉴스 2025-09-26 (부산국제록페스티벌) | https://www.fnnews.com/news/202509261925182963 | 2025 부산국제록페스티벌은 삼락생태공원에서 3일간 열렸고 4개 무대(삼락·그린·리버·히든)에서 오전 11:30 첫 공연부터 20:40~22:00 헤드라이너까지 진행했다. 해외 17팀, 국내 64팀이 출연했다. | 가상 페스티벌을 3일, 다중 무대, 정오~22시대 run-of-show로 구성 |
| S9 | 한국경제 2026-09-07 | https://www.hankyung.com/article/2026090793691 | 2026 부산국제록페스티벌(10/2~4, 삼락생태공원)의 최종 출연은 99개 팀이다. | 공연 Case 규모(99건)의 현실성 참고 |
| S10 | ProSoundWeb — festival changeover | https://www.prosoundweb.com/?p=36647 | 페스티벌은 일반 공연보다 체인지오버 시간이 짧고, 오프닝 아티스트는 콘솔 입력만 확인하는 라인체크만 하는 경우가 흔하다. | 모든 공연에 사운드체크를 가정하지 않음, `Line Check` 선택 수행 |
| S11 | FestivalPro — Managing Rapid Artist Changeovers | https://festivalpro.com/festival-management/2012/news/2022/7/28/Managing-Rapid-Artist-Changeovers-for-Music-Festival-Stages.html | 아티스트 advance(무대 배치, 백라인 사양, 시간)를 사전에 받아 stage manager가 체인지오버를 계획한다. 백라인에 익숙한 기술자와 엔지니어가 핵심 인력이다. | Stage Setup의 입력(stage plot / rider), 역할 구성 |
| S12 | Shambala Festival 2025 Artist Info (PDF) | https://www.shambalafestival.org/wp-content/uploads/SH25_Artist-Info-2025.pdf | 공연 3시간 전 체크인을 요구한다. 체인지오버는 약 30분으로 빠듯하다. stage manager가 현장 시간과 이동을 조율한다. | MAIN 체인지오버 30–40분, SM 역할 |
| S13 | 행정안전부 다중운집인파사고 안전관리 가이드라인(2024, 배포용 PDF) | https://cse.snu.ac.kr/api/v1/file/1730252035876_%5B%EB%B6%99%EC%9E%843%5D%20240905%20%EB%8B%A4%EC%A4%91%EC%9A%B4%EC%A7%91%EC%9D%B8%ED%8C%8C%EC%82%AC%EA%B3%A0%20%EC%95%88%EC%A0%84%EA%B4%80%EB%A6%AC%20%EA%B0%80%EC%9D%B4%EB%93%9C%EB%9D%BC%EC%9D%B8(%EB%B0%B0%ED%8F%AC%EC%9A%A9).pdf | 지역축제·공연 등 다중운집 행사의 안전관리 체계와 관련 법령을 제시하고, 공연 관객 안전관리 체크리스트 기준(0.46㎡/인)을 언급한다. | 입장 개선안을 '처리 속도'만이 아니라 안전 인력 범위 안에서 제안(보안 인력 재배치 금지) |

참고만 하고 수치는 쓰지 않은 자료:
- Ticket Fairy Promoter Blog(입장 lane당 처리량 경험치, 체인지오버 팁): 업계 블로그라 공식 근거로 쓰지 않았다. 처리량 수치는 생성 모델에 사용하지 않았다.
- 부산시 영문 보도자료(라인업, 일정): 운영 절차 정보가 없다.

## 2. 확인하지 못한 것 (조사 한계)

- 펜타포트·부산록·Fuji Rock의 **게이트 수, 검표 인력 수, 서비스 시간, 대기시간, 스캔 실패율, 거절률**은 공개 자료에서 찾지 못했다. 따라서 데이터의 해당 수치는 모두 가정이다.
- 실제 페스티벌의 **무대 기술 인력 편성, 교대 시각, 체인지오버 실패율, 장비 요청 리드타임**도 공개되어 있지 않다.
- 펜타포트 공식 홈페이지(pentaport.co.kr)는 이 환경의 조회 허용 목록에 없어 직접 확인하지 못했다. 펜타포트 관련 사실은 언론 보도와 여행 플랫폼 안내에 근거한다.
- 부산국제록페스티벌 공식 관람 안내 페이지의 입장 절차는 확인하지 못했다.

## 3. 사용 원칙
1. 데이터셋 이름은 가상이다(**Demo Festival Operations 2026**). 실존 페스티벌 이름은 운영 관행의 출처로만 쓴다.
2. 합성 로그에서 발견한 병목을 실존 페스티벌의 성과로 서술하지 않는다.
3. 이 문서의 URL은 `dataset_manifest.json`의 `source_references`에도 들어 있다(10개).
