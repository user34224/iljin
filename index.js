const express = require("express");
const sharp = require("sharp");
const opentype = require("opentype.js");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

const mgDir = path.join(__dirname, "mg");
const MAX_STAT_LEN = 300; // 필요시 조정

// 한 번만 안전 디코딩 시도
function safeDecode(value = "") {
    if (value === undefined || value === null) return "";
    try {
        return decodeURIComponent(String(value));
    } catch {
        return String(value);
    }
}

// XML 이스케이프 (안전하게 문자열로 변환)
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

// 간단한 텍스트 래핑
function wrapText(text, maxChars) {
    if (!text || maxChars <= 0) return [text];
    if (text.length <= maxChars) return [text];

    const lines = [];
    let current = "";

    for (let char of text) {
        if (current.length >= maxChars) {
            lines.push(current);
            current = char;
        } else {
            current += char;
        }
    }

    if (current) lines.push(current);
    return lines.length > 0 ? lines : [text];
}

app.get("/image", async (req, res) => {
    try {
        // 기본 파라미터
        const imgNum = parseInt(req.query.img) || 1;
        const text = req.query.text || "안녕하세요";
        const name = req.query.name || "";
        const fontSize = parseInt(req.query.size) || 28;

        // stat은 한 번만 안전 디코딩
        const statRaw = req.query.stat || "stat";
        let stat = safeDecode(statRaw);

        // 길이 제한(너무 길면 잘라서 처리)
        if (stat.length > MAX_STAT_LEN) {
            stat = stat.slice(0, MAX_STAT_LEN) + "...";
        }

        // 캐시 키
        const cacheKey = `${imgNum}_${name}_${text}_${fontSize}_${stat}`;
        res.set("Cache-Control", "public, max-age=31536000, immutable");

        const imageFile = `${imgNum}.jpg`;
        const imagePath = path.join(mgDir, imageFile);

        if (!fs.existsSync(imagePath)) {
            return res.status(404).send(`이미지를 찾을 수 없습니다: ${imageFile}`);
        }

        const metadata = await sharp(imagePath).metadata();
        const width = metadata.width;
        const height = metadata.height;

        // 디버그 로그
        console.log("REQ URL:", req.originalUrl);
        console.log("statRaw:", JSON.stringify(statRaw));
        console.log("statDecoded:", JSON.stringify(stat));
        console.log("name:", JSON.stringify(name));

        // 레이아웃 변수
        let fontSize_ = Math.floor(fontSize);
        let nameSize = Math.floor(fontSize * 1.3);
        const padding = 40;
        const boxPadding = 30;
        const lineHeight = fontSize_ + 8;

        const boxHeight = Math.floor(height * 0.20);
        const boxMargin = 20;
        const boxTop = height - boxHeight - boxMargin;
        const boxWidth = width - boxMargin * 2;
        const boxRadius = 15;

        // 폰트 로드(있으면 base64로 임베드)
        const fontPath = path.join(__dirname, "font", "Nanum.ttf");
        let fontBase64 = null;
        try {
            if (fs.existsSync(fontPath)) {
                fontBase64 = fs.readFileSync(fontPath).toString("base64");
            }
        } catch (e) {
            console.warn("폰트 로드 실패:", e.message);
        }

        // opentype 객체 로드 시도
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

        // stat 위치 계산 및 클램프
        const statFontSize = Math.floor(nameSize * 0.6);
        const statBoxX = boxMargin + padding + Math.floor(name.length * nameSize * 0.55) + 40;
        const statMaxX = boxMargin + boxWidth - padding - 10;
        const statX = Math.min(statBoxX, statMaxX);

        // 안전한 stat 텍스트
        const statText = escapeXml(stat);

        // name 렌더링 (opentype path 시도, 실패하면 <text>로 폴백)
        if (name) {
            if (fontObj) {
                try {
                    const namePath = fontObj.getPath(name, boxMargin + padding, nameY, nameSize);
                    const d = namePath && (namePath.toPathData ? namePath.toPathData(2) : namePath.toSVG());
                    if (d && d.length > 0) {
                        textSvg += `<path d="${d}" fill="white" />`;
                    } else {
                        throw new Error("empty name path");
                    }
                } catch (e) {
                    console.warn("name path render failed:", e && e.message);
                    textSvg += `<text x="${boxMargin + padding}" y="${nameY}" font-size="${nameSize}" fill="white" class="text shadow">${escapeXml(name)}</text>`;
                }
            } else {
                textSvg += `<text x="${boxMargin + padding}" y="${nameY}" font-size="${nameSize}" fill="white" class="text shadow">${escapeXml(name)}</text>`;
            }
        }

        // stat 렌더링: opentype path 시도, 실패하면 <text>로 폴백. 절대 예외를 던지지 않음
        try {
            if (fontObj) {
                try {
                    const statPath = fontObj.getPath(stat, statX, nameY, statFontSize);
                    const statD = statPath && (statPath.toPathData ? statPath.toPathData(2) : statPath.toSVG());
                    if (statD && statD.length > 0) {
                        textSvg += `<path d="${statD}" fill="white" />`;
                    } else {
                        throw new Error("empty stat path");
                    }
                } catch (e) {
                    console.warn("stat path render failed:", e && e.message);
                    textSvg += `<text x="${statX}" y="${nameY}" font-size="${statFontSize}" fill="white" class="text shadow">${statText}</text>`;
                }
            } else {
                textSvg += `<text x="${statX}" y="${nameY}" font-size="${statFontSize}" fill="white" class="text shadow">${statText}</text>`;
            }
        } catch (e) {
            // 안전망: 어떤 예외가 와도 stat은 텍스트로 출력
            console.error("unexpected stat render error:", e && e.message);
            textSvg += `<text x="${statX}" y="${nameY}" font-size="${statFontSize}" fill="white" class="text shadow">${statText}</text>`;
        }

        // 본문 텍스트 렌더링 (wrap 적용)
        const lines = text.split("\n");
        lines.forEach((line) => {
            if (!line) return;
            const wrapped = wrapText(line, maxCharsPerLine);
            wrapped.forEach((ln) => {
                if (textY < boxTop + boxHeight - 15) {
                    if (fontObj) {
                        try {
                            const p = fontObj.getPath(ln, boxMargin + padding, textY, fontSize_);
                            const dd = p && (p.toPathData ? p.toPathData(2) : p.toSVG());
                            if (dd && dd.length > 0) {
                                textSvg += `<path d="${dd}" fill="white" />`;
                            } else {
                                throw new Error("empty line path");
                            }
                        } catch (e) {
                            console.warn("line path render failed:", e && e.message);
                            textSvg += `<text x="${boxMargin + padding}" y="${textY}" font-size="${fontSize_}" fill="white" class="text shadow">${escapeXml(ln)}</text>`;
                        }
                    } else {
                        textSvg += `<text x="${boxMargin + padding}" y="${textY}" font-size="${fontSize_}" fill="white" class="text shadow">${escapeXml(ln)}</text>`;
                    }
                    textY += lineHeight;
                }
            });
        });

        textSvg += `</svg>`;

        // sharp 합성 및 변환, 실패 시 debug.svg 저장
        let result = sharp(imagePath)
            .composite([{ input: Buffer.from(textSvg), blend: "over" }])
            .resize(width, height, { fit: "fill" });

        res.type("image/png");
        res.set({ "Cache-Control": "public, max-age=600", ETag: false });

        let output;
        try {
            output = await result.png().toBuffer();
        } catch (e) {
            // 디버그용 SVG 저장
            try {
                fs.writeFileSync(path.join(__dirname, "debug.svg"), textSvg, "utf8");
                console.error("Sharp 변환 에러, debug.svg 생성:", e && e.message);
            } catch (fsErr) {
                console.error("debug.svg 저장 실패:", fsErr && fsErr.message);
            }
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
    console.log(`📱 사용법 예: /image?img=1&name=수아&text=안녕하세요&stat=|♥호감도 10%♥|`);
    console.log(`✅ 준비 완료!`);
});
