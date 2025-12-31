# Design Guidelines: 글로벌 엠파이어 - 실시간 전략 게임

## Design Approach
**선택된 접근법**: Design System Approach (Carbon Design + Custom Gaming Elements)

**이유**: 
- 정보 밀도가 높은 전략 게임 (100개 도시, 실시간 턴, 다중 자원 관리)
- 데이터 중심 인터페이스 (대시보드, 통계, 실시간 업데이트)
- 장시간 플레이를 고려한 시각적 안정성 필요
- Carbon Design의 데이터 집약적 UI 패턴 활용 + 게임 특화 요소 추가

**참고 게임**: Civilization VI (정보 패널), Paradox Interactive 게임들 (복잡한 UI), Total War (전투 인터페이스)

## Core Design Principles

### 1. Information Hierarchy & Density
- **3-tier 정보 구조**: 
  - Primary: 턴 타이머, 현재 자원, 선택된 요소
  - Secondary: 도시 목록, 병력 상태, 외교 관계
  - Tertiary: 상세 통계, 히스토리, 뉴스 피드

### 2. Real-time Feedback
- 턴 카운터: 큰 디지털 숫자 (36-48px), 남은 시간은 진행 바로 시각화
- 자원 변화: 증가(녹색)/감소(빨강) 애니메이션 (1초 페이드)
- 전투 알림: 빨간색 펄스 효과, 중요도에 따라 크기 조절

### 3. Dark Theme Foundation
- 배경: `#0f1419` (메인), `#1a1f28` (패널)
- 텍스트: `#e8eaed` (primary), `#9aa0a6` (secondary)
- 강조: `#4285f4` (아군/선택), `#ea4335` (적군/경고), `#34a853` (성공/동맹)

## Typography

**Primary Font**: Inter (시스템 UI에 최적화)
- Headings: 600 weight, 24-32px (도시명, 섹션 타이틀)
- Body: 400 weight, 14-16px (일반 텍스트, 설명)
- Data/Stats: 500 weight, 12-14px (숫자, 자원 표시)
- Monospace: JetBrains Mono 400 (턴 카운터, 타이머)

**Hierarchy**:
- H1 (32px/600): 메인 화면 타이틀 (게임명, 방 이름)
- H2 (24px/600): 패널 헤더 (도시 관리, 전투 화면)
- H3 (18px/500): 서브섹션 (건물 목록, 병과 선택)
- Body (16px/400): 설명 텍스트, 뉴스 내용
- Caption (14px/400): 보조 정보, 툴팁
- Data (14px/500): 자원 수치, 통계

## Layout System

**Spacing Units**: Tailwind 기준 `2, 4, 6, 8, 12, 16` 사용
- 컴포넌트 간격: `gap-4` (16px)
- 패널 패딩: `p-6` (24px)
- 섹션 마진: `mb-8` (32px)
- 밀집 레이아웃: `gap-2` (8px) - 자원 표시, 병과 아이콘 등

**Grid Structure** (메인 게임 화면):
```
[상단 바: h-16, 고정]
[좌측 패널: w-80] [중앙 맵: flex-1] [우측 패널: w-96]
[하단 바: h-20, 고정]
```

## Component Library

### Navigation & Panels
- **상단 바**: 
  - 고정 높이 `h-16`, 배경 `#1a1f28`, 하단 테두리 `border-b-2 border-gray-700`
  - 턴 카운터 좌측, 자원 표시 중앙, 알림/설정 우측
  
- **좌측/우측 패널**: 
  - 너비 고정(`w-80`/`w-96`), 스크롤 가능 `overflow-y-auto`
  - 배경 반투명 `bg-gray-900/95`, 테두리 `border-r border-gray-700`
  - 섹션 구분: `border-b border-gray-700 pb-4 mb-4`

- **하단 채팅/탭 바**:
  - 탭 스타일: 활성 탭 `border-b-2 border-blue-500`, 비활성 `text-gray-400`

### Core UI Elements

**자원 표시 카드**:
- 크기: `w-20 h-16`, 배경 `bg-gray-800`, 테두리 `border border-gray-600`
- 아이콘 상단(`text-2xl`), 수치 하단(`text-sm font-mono`)
- 증가/감소 표시: 우측 상단 작은 화살표 `text-xs`

**도시/타일 정보 카드**:
- 배경: `bg-gray-800`, 패딩 `p-4`, 모서리 `rounded-lg`
- 헤더: 도시명(`text-lg font-semibold`) + 등급 아이콘
- 본문: 2열 그리드 `grid grid-cols-2 gap-2` (자원/병력 표시)
- 액션 버튼: 하단 `flex gap-2 mt-4`

**전투 인터페이스**:
- 중앙 분할 레이아웃: `grid grid-cols-2 gap-8`
- 공격자(좌측) vs 방어자(우측), 배경 구분 (`bg-red-900/20` vs `bg-blue-900/20`)
- 전략 입력: 큰 텍스트 에어리어 `h-32`, 글자 수 카운터 `text-xs text-gray-400`

**건물 선택 그리드**:
- `grid grid-cols-3 gap-4` (좌측 패널 기준)
- 각 건물: 정사각형 카드, 아이콘 중앙, 이름 하단, 비용 우측 상단 뱃지

### Forms & Inputs

**방 생성 폼**:
- 라벨 스타일: `text-sm font-medium text-gray-300 mb-2`
- 입력 필드: `bg-gray-800 border border-gray-600 focus:border-blue-500 rounded px-3 py-2`
- 선택 버튼: 라디오 버튼 스타일, 선택 시 `bg-blue-900 border-blue-500`

**버튼 스타일**:
- Primary: `bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-medium`
- Secondary: `bg-gray-700 hover:bg-gray-600 text-gray-200 px-4 py-2 rounded`
- Danger: `bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded`
- Small: `px-3 py-1 text-sm`

### Data Displays

**진행 바** (턴 타이머, 건설 진행):
- 높이 `h-2`, 배경 `bg-gray-700`, 진행 `bg-blue-500`
- 텍스트 하단 표시 `text-xs text-gray-400`

**통계 테이블**:
- 헤더: `bg-gray-800 border-b-2 border-gray-600 font-semibold`
- 행: `border-b border-gray-700 hover:bg-gray-800/50`
- 수치 우측 정렬 `text-right font-mono`

**뉴스 피드**:
- 각 뉴스: `border-l-4` 카테고리별 색상(전투: 빨강, 외교: 파랑, 경제: 초록)
- 시간 표시: `text-xs text-gray-500` 우측 상단
- 중요 뉴스: 배경 `bg-yellow-900/10`

### Overlays & Modals

**모달** (전투 결과, 도시 상세):
- 배경 오버레이: `bg-black/80`
- 모달 컨테이너: `bg-gray-900 border border-gray-600 rounded-lg max-w-2xl p-6`
- 닫기 버튼: 우측 상단 X 아이콘

**툴팁**:
- `bg-gray-800 border border-gray-600 text-sm px-3 py-2 rounded shadow-lg`
- 위치: 호버 요소 상단 또는 하단, 화살표 표시

## Pixi.js Map Specific

**타일 시각화**:
- 육각형 테두리: 소유국별 색상 (2px 두께)
- 타일 배경: 지형별 텍스처 (평야: 연한 초록, 산악: 회색, 바다: 파랑)
- 선택 효과: 노란색 하이라이트 테두리 (4px, 펄스 애니메이션)
- 호버 효과: 약간 밝아지는 오버레이 (opacity 0.1)

**아이콘 레이어**:
- 병력: 좌상단 (16x16px 아이콘)
- 건물: 우상단 (16x16px 아이콘)
- 도시: 중앙 (32x32px, 등급별 다른 아이콘)
- 특산물: 하단 (작은 아이콘, 12x12px)

**미니맵**:
- 우하단 고정 위치, 크기 `200x150px`
- 배경 반투명 `bg-gray-900/90`, 테두리 `border border-gray-600`
- 현재 뷰포트 표시: 노란색 사각형 오버레이

## Animations (매우 절제)

**사용 허용**:
- 턴 종료 카운트다운: 마지막 10초 숫자 펄스 (급박감)
- 전투 발생: 타일 빨간색 점멸 (2초, 3회)
- 자원 증감: 숫자 페이드인 (0.5초)

**사용 금지**:
- 페이지 전환 애니메이션
- 버튼 호버 복잡한 효과
- 불필요한 로딩 스피너 (1초 이상 걸릴 때만)

## Accessibility

- 포커스 표시: `focus:outline-none focus:ring-2 focus:ring-blue-500`
- 색맹 고려: 색상만으로 정보 전달 금지, 항상 아이콘/텍스트 병기
- 키보드 단축키: ESC (모달 닫기), Space (턴 스킵), Tab (포커스 이동)
- 대비율: 최소 4.5:1 유지 (WCAG AA 기준)

## Responsive Considerations

**최소 해상도**: 1366x768 (노트북 기준)
- 1366-1600px: 좌측 패널 축소 `w-64`, 우측 유지
- 1600px+: 전체 레이아웃 유지
- **모바일 미지원** (게임 특성상 데스크톱 전용)