const express = require("express");
const sharp = require("sharp");
const opentype = require("opentype.js");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

const mgDir = path.join(__dirname, "mg");

// 안전 디코딩 함수
function safeDecode(value = "") {
    if (!value) return "";
    try {
        return decodeURIComponent(value);
    } catch {
        return value; // 잘못된 % 시퀀스면 원문 그대로
    }
}

app.get("/image", async (req, res) => {
    try {
        const imgNum = parseInt(req.query.img) || 1;
        const text = req.query.text || "안녕하세요";
        const name = req.query.name || "";
        const fontSize = parseInt(req.query.size) || 28;

        // stat만 안전 디코딩 적용
        const statRaw = req.query.stat || "stat";
        const stat = safeDecode(statRaw);

        // 캐시 키 생성
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

        console.log(`📸 생성 중: ${imageFile} (${width}x${height})`);

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

        const fontPath = path.join(__dirname, "font", "Nanum.ttf");
        let fontBase64 = null;
        try {
            if (fs.existsSync(fontPath)) {
                fontBase64 = fs.readFileSync(fontPath).toString("base64");
            }
        } catch (e) {
            console.warn("폰트 로드 실패:", e.message);
        }

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

        let textSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <style>
            ${fontBase64
                ? `@font-face { font-family: 'Nanum'; src: url('data:font/truetype;charset=utf-8;base64,${fontBase64}') format('truetype'); font-weight: normal; font-style: normal; }`
                : ""
            }
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

        const statFontSize = Math.floor(nameSize * 0.6);
        const statBoxX =
            boxMargin + padding + Math.floor(nameSize * name.length * 0.55) + 40;

        const lines = text.split("\n");

        if (fontObj) {
            if (name) {
                const namePath = fontObj.getPath(
                    name,
                    boxMargin + padding,
                    nameY,
                    nameSize
                );
                const d = namePath.toPathData ? namePath.toPathData(2) : namePath.toSVG();
                textSvg += `<path d="${d}" fill="white" />`;

                const statPath = fontObj.getPath(stat, statBoxX, nameY, statFontSize);
                const statD = statPath.toPathData
                    ? statPath.toPathData(2)
                    : statPath.toSVG();
                textSvg += `<path d="${statD}" fill="white" />`;
            }

            lines.forEach((line) => {
                if (line.trim()) {
                    const wrappedLines = wrapText(line, maxCharsPerLine);
                    wrappedLines.forEach((wrappedLine) => {
                        if (textY < boxTop + boxHeight - 15) {
                            const p = fontObj.getPath(
                                wrappedLine,
                                boxMargin + padding,
                                textY,
                                fontSize_
                            );
                            const dd = p.toPathData ? p.toPathData(2) : p.toSVG();
                            textSvg += `<path d="${dd}" fill="white" />`;
                            textY += lineHeight;
                        }
                    });
                }
            });
        } else {
            if (name) {
                textSvg += `<text x="${boxMargin + padding}" y="${nameY}" font-size="${nameSize}" fill="white" class="text shadow">${escapeXml(
                    name
                )}</text>`;
                textSvg += `<text x="${statBoxX}" y="${nameY}" font-size="${statFontSize}" fill="white" class="text shadow">${escapeXml(
                    stat
                )}</text>`;
            }

            lines.forEach((line) => {
                if (line.trim()) {
                    const wrappedLines = wrapText(line, maxCharsPerLine);
                    wrappedLines.forEach((wrappedLine) => {
                        if (textY < boxTop + boxHeight - 15) {
                            textSvg += `<text x="${boxMargin + padding}" y="${textY}" font-size="${fontSize_}" fill="white" class="text shadow">${escapeXml(
                                wrappedLine
                            )}</text>`;
                            textY += lineHeight;
                        }
                    });
                }
            });
        }

        textSvg += `</svg>`;

        let result = sharp(imagePath)
            .composite([{ input: Buffer.from(textSvg), blend: "over" }])
            .resize(width, height, { fit: "fill" });

        res.type("image/png");
        res.set({ "Cache-Control": "public, max-age=600", ETag: false });
        let output;
        try {
            output = await result.png().toBuffer();
        } catch (e) {
            console.error("Sharp 변환 에러:", e);
            throw e;
        }
        res.send(output);
    } catch (err) {
        console.error("❌ 에러:", err.message);
        res.status(500).send(`에러: ${err.message}`);
    }
});

function escapeXml(str) {
    return str.replace(/[&<>"']/g, function (c) {
        switch (c) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            case "'":
                return "&apos;";
        }
    });
}

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

app.listen(PORT, () => {
    console.log(`🚀 서버 시작: http://localhost:${PORT}/image`);
    console.log(
        `📱 사용법: /image?img=1&name=민수&text=안녕하세요&stat=|♥호감도 10%♥|`
    );
    console.log(`✅ 준비 완료!`);
});
