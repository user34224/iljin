const express = require("express");
const sharp = require("sharp");
const opentype = require('opentype.js');
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

const mgDir = path.join(__dirname, "mg");
const MAX_STAT_LEN = 400;

// robust stat 디코드: 퍼센트 인코딩이 있으면 한 번만 디코드 시도,
// 디코드 결과가 비정상적이면 원본 복구
function robustDecodeStat(raw) {
    if (raw === undefined || raw === null) return "";
    let orig = String(raw);
    orig = orig.replace(/\+/g, " ");
    if (!/%[0-9A-Fa-f]{2}/.test(orig)) return orig; // 이미 디코딩된 경우
    let v = orig;
    for (let i = 0; i < 2; i++) {
        try {
            const decoded = decodeURIComponent(v);
            if (!decoded || /[\u0000-\u001F\u007F]|�/.test(decoded)) return orig;
            if (decoded === v) return decoded;
            v = decoded;
        } catch (e) {
            try {
                const sanitized = v.replace(/%(?![0-9A-Fa-f]{2})/g, "%25");
                const decoded2 = decodeURIComponent(sanitized);
                if (!decoded2 || /[\u0000-\u001F\u007F]|�/.test(decoded2)) return orig;
                return decoded2;
            } catch (e2) {
                return orig;
            }
        }
    }
    return v || orig;
}

function escapeXml(input) {
    const str = String(input || "");
    return str.replace(/[&<>"']/g, function (c) {
        switch (c) {
            case "&": return "&amp;";
            case "<": return "&lt;";
            case ">": return "&gt;";
            case '"': return "&quot;";
            case "'": return "&apos;";
            default: return c;
        }
    });
}

function wrapText(text, maxChars) {
    if (!text || maxChars <= 0) return [text];
    if (text.length <= maxChars) return [text];
    const lines = [];
    let current = "";
    for (let ch of text) {
        if (current.length >= maxChars) {
            lines.push(current);
            current = ch;
        } else {
            current += ch;
        }
    }
    if (current) lines.push(current);
    return lines;
}

app.get("/image", async (req, res) => {
    try {
        const imgNum = parseInt(req.query.img) || 1;
        const text = req.query.text || "안녕하세요";
        const name = req.query.name || "";
        const fontSize = parseInt(req.query.size) || 28;

        // stat은 name과 다르게 받음: 클라이언트에서 전달된 값을 robust하게 디코딩
        const statRaw = req.query.stat;
        const stat = robustDecodeStat(statRaw || "stat");
        const statSafeForLog = stat.length > 200 ? stat.slice(0, 200) + "..." : stat;

        // 캐시 키
        const cacheKey = `${imgNum}_${name}_${text}_${fontSize}_${stat}`;
        res.set("Cache-Control", "public, max-age=31536000, immutable");

        // 이미지 파일
        const imageFile = `${imgNum}.jpg`;
        const imagePath = path.join(mgDir, imageFile);
        if (!fs.existsSync(imagePath)) return res.status(404).send(`이미지를 찾을 수 없습니다: ${imageFile}`);

        const metadata = await sharp(imagePath).metadata();
        const width = metadata.width;
        const height = metadata.height;

        // 로그 (디버깅용)
        console.log("REQ URL:", req.originalUrl);
        console.log("statRaw:", JSON.stringify(statRaw));
        console.log("statDecoded:", JSON.stringify(statSafeForLog));
        console.log("name:", JSON.stringify(name));

        // 레이아웃 변수
        const fontSize_ = Math.floor(fontSize);
        const nameSize = Math.floor(fontSize * 1.3);
        const padding = 40;
        const boxPadding = 30;
        const lineHeight = fontSize_ + 8;
        const boxHeight = Math.floor(height * 0.20);
        const boxMargin = 20;
        const boxTop = height - boxHeight - boxMargin;
        const boxWidth = width - boxMargin * 2;
        const boxRadius = 15;

        // 폰트 로드 (base64 임베드 시도)
        const fontPath = path.join(__dirname, "font", "Nanum.ttf");
        let fontBase64 = null;
        try { if (fs.existsSync(fontPath)) fontBase64 = fs.readFileSync(fontPath).toString("base64"); }
        catch (e) { console.warn("폰트 로드 실패:", e.message); }

        // opentype 로드 시도 (name은 path로 렌더링 시도 가능)
        let fontObj = null;
        try {
            if (fs.existsSync(fontPath)) {
                fontObj = await new Promise((resolve, reject) => {
                    opentype.load(fontPath, (err, f) => (err ? reject(err) : resolve(f)));
                });
            }
        } catch (e) {
            console.warn("opentype 로드 실패:", e.message);
            fontObj = null;
        }

        // SVG 시작
        let textSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        ${fontBase64 ? `@font-face { font-family: 'Nanum'; src: url('data:font/truetype;charset=utf-8;base64,${fontBase64}') format('truetype'); }` : ''}
        .text { font-family: 'Nanum', Arial, sans-serif; font-weight: bold; }
        .shadow { filter: drop-shadow(2px 2px 4px rgba(0,0,0,0.8)); }
      </style>
    </defs>
    <rect x="${boxMargin}" y="${boxTop}" width="${boxWidth}" height="${boxHeight}" rx="${boxRadius}" ry="${boxRadius}" fill="black" opacity="0.6" />`;

        const nameY = boxTop + boxPadding + Math.floor(nameSize * 0.8);
        let textY = nameY + lineHeight + 5;
        const maxWidth = boxWidth - padding * 2;
        const charWidth = fontSize_ * 0.55;
        const maxCharsPerLine = Math.floor(maxWidth / charWidth);

        // stat 위치 계산 (기존 위치·크기 유지)
        const statFontSize = Math.floor(nameSize * 0.6);
        const statBoxX = boxMargin + padding + Math.floor(nameSize * name.length * 0.55) + 40;
        const statMaxX = boxMargin + boxWidth - padding - 10;
        const statX = Math.min(statBoxX, statMaxX);
        const statText = escapeXml(stat);

        // 이름 렌더링: opentype이 있으면 path로 시도, 실패하면 <text>로 폴백
        if (name) {
            if (fontObj) {
                try {
                    const namePath = fontObj.getPath(name, boxMargin + padding, nameY, nameSize);
                    const d = namePath && (namePath.toPathData ? namePath.toPathData(2) : namePath.toSVG());
                    if (d && d.length > 0) textSvg += `<path d="${d}" fill="white" />`;
                    else throw new Error("empty name path");
                } catch (e) {
                    console.warn("name path render failed:", e && e.message);
                    textSvg += `<text x="${boxMargin + padding}" y="${nameY}" font-size="${nameSize}" fill="white" class="text shadow">${escapeXml(name)}</text>`;
                }
            } else {
                textSvg += `<text x="${boxMargin + padding}" y="${nameY}" font-size="${nameSize}" fill="white" class="text shadow">${escapeXml(name)}</text>`;
            }
        }

        // stat 렌더링: 항상 <text>로 출력하여 path 예외로 인한 소실 방지
        textSvg += `<text x="${statX}" y="${nameY}" font-size="${statFontSize}" fill="white" class="text shadow">${statText}</text>`;

        // 본문 텍스트 렌더링 (wrap 적용, 기존 동작 유지)
        const lines = text.split("\n");
        for (const line of lines) {
            if (!line) continue;
            const wrapped = wrapText(line, maxCharsPerLine);
            for (const ln of wrapped) {
                if (textY < boxTop + boxHeight - 15) {
                    if (fontObj) {
                        try {
                            const p = fontObj.getPath(ln, boxMargin + padding, textY, fontSize_);
                            const dd = p && (p.toPathData ? p.toPathData(2) : p.toSVG());
                            if (dd && dd.length > 0) textSvg += `<path d="${dd}" fill="white" />`;
                            else throw new Error("empty line path");
                        } catch (e) {
                            console.warn("line path render failed:", e && e.message);
                            textSvg += `<text x="${boxMargin + padding}" y="${textY}" font-size="${fontSize_}" fill="white" class="text shadow">${escapeXml(ln)}</text>`;
                        }
                    } else {
                        textSvg += `<text x="${boxMargin + padding}" y="${textY}" font-size="${fontSize_}" fill="white" class="text shadow">${escapeXml(ln)}</text>`;
                    }
                    textY += lineHeight;
                }
            }
        }

        textSvg += `</svg>`;

        console.log('폰트 base64 존재:', !!fontBase64);
        console.log('SVG 길이:', textSvg.length);

        // 이미지 합성
        let result = sharp(imagePath)
            .composite([{ input: Buffer.from(textSvg), blend: 'over' }])
            .resize(width, height, { fit: 'fill' });

        res.type("image/png");
        res.set({ "Cache-Control": "public, max-age=600", "ETag": false });

        let output;
        try {
            output = await result.png().toBuffer();
            console.log('생성된 이미지 바이트 길이:', output.length);
        } catch (e) {
            try { fs.writeFileSync(path.join(__dirname, "debug.svg"), textSvg, "utf8"); console.error("Sharp 변환 에러, debug.svg 생성:", e && e.message); } catch (fsErr) { console.error("debug.svg 저장 실패:", fsErr && fsErr.message); }
            throw e;
        }

        res.send(output);
    } catch (err) {
        console.error("❌ 에러:", err && err.message);
        res.status(500).send(`에러: ${err && err.message}`);
    }
});

app.listen(PORT, () => {
    console.log(`🚀 서버 시작: http://localhost:${PORT}/image`);
    console.log(`📱 사용법: /image?img=1&name=민수&text=안녕하세요&size=28&stat=|♥호감도 10%♥|`);
});
