# 캐릭터 대화 이미지 생성기

URL 파라미터를 통해 실시간으로 캐릭터 이미지에 대사를 추가하는 Node.js + Express 서버입니다.

## 설치

```bash
npm install
```

## 사용법

서버 시작:
```bash
node index.js
```

### API 엔드포인트

```
GET /image?img=1&name=민수&text=안녕하세요&size=28
```

**파라미터:**
- `img` (필수): 이미지 번호 (1 또는 2)
- `text` (필수): 표시할 대사
- `name` (선택): 캐릭터 이름
- `size` (선택): 글자 크기 (기본값: 28)

### 예시

```
http://localhost:3000/image?img=1&name=민수&text=안녕하세요
http://localhost:3000/image?img=2&text=반갑습니다&size=32
```

## 기능

- ✅ 배경 이미지에 직접 텍스트 오버레이
- ✅ 이름과 대사 표시 (이름은 더 크게)
- ✅ 반투명 검은색 박스 배경 (둥근 모서리)
- ✅ 자동 텍스트 줄바꿈
- ✅ 드롭섀도우 텍스트 효과

## 기술 스택

- Node.js
- Express.js
- Sharp (이미지 처리)
