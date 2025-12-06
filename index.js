app.get("/image", async (req, res) => {
    try {
        const imgNum = parseInt(req.query.img) || 1;

        let text = req.query.text || "안녕하세요";
        let name = req.query.name || "";
        let stat = req.query.stat || "stat";

        // ✅ ✅ ✅ 모바일 + PC 공통 디코딩 (핵심)
        try { text = decodeURIComponent(text); } catch { }
        try { name = decodeURIComponent(name); } catch { }
        try { stat = decodeURIComponent(stat); } catch { }

        const fontSize = parseInt(req.query.size) || 28;

        const imageFile = `${imgNum}.jpg`;
        const imagePath = path.join(mgDir, imageFile);

        if (!fs.existsSync(imagePath)) {
            return res.status(404).send("이미지 없음");
        }

        const metadata = await sharp(imagePath).metadata();
        const width = metadata.width;
        const height = metadata.height;

        const fontSize_ = Math.floor(fontSize);
        const nameSize = Math.floor(fontSize * 1.3);
        const padding = 40;
        const boxPadding = 30;
        const lineHeight = fontSize_ + 8;

        const boxHeight = Math.floor(height * 0.20);
        const boxMargin = 20;
        const boxTop = height - boxHeight - boxMargin;
        const boxWidth = width - (boxMargin * 2);

        const nameY = boxTop + boxPadding + Math.floor(nameSize * 0.8);
        let textY = nameY + lineHeight + 5;

        const maxWidth = boxWidth - (padding * 2);
        const charWidth = fontSize_ * 0.55;
        const maxCharsPerLine = Math.floor(maxWidth / charWidth);

        const statFontSize = Math.floor(nameSize * 0.6);
        const statBoxX = boxMargin + padding + Math.floor(nameSize * name.length * 0.55) + 40;

        let textSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        text {
          font-family: Arial, sans-serif;
          font-weight: bold;
          fill: white;
        }
      </style>
      <rect x="${boxMargin}" y="${boxTop}" width="${boxWidth}" height="${boxHeight}" rx="15" ry="15" fill="black" opacity="0.6" />
    `;

        if (name) {
            textSvg += `<text x="${boxMargin + padding}" y="${nameY}" font-size="${nameSize}">${escapeXml(name)}</text>`;
            textSvg += `<text x="${statBoxX}" y="${nameY}" font-size="${statFontSize}">${escapeXml(stat)}</text>`;
        }

        const lines = text.split("\n");

        lines.forEach((line) => {
            const wrappedLines = wrapText(line, maxCharsPerLine);
            wrappedLines.forEach((wl) => {
                if (textY < boxTop + boxHeight - 10) {
                    textSvg += `<text x="${boxMargin + padding}" y="${textY}" font-size="${fontSize_}">${escapeXml(wl)}</text>`;
                    textY += lineHeight;
                }
            });
        });

        textSvg += `</svg>`;

        // ✅ ✅ ✅ utf-8 강제 (이게 모바일 한글 깨짐 마지막 원인)
        const output = await sharp(imagePath)
            .composite([
                {
                    input: Buffer.from(textSvg, "utf-8"),
                    blend: "over"
                }
            ])
            .jpeg()
            .toBuffer();

        // ✅ ✅ ✅ JPG 헤더 정확히 지정
        res.setHeader("Content-Type", "image/jpeg; charset=utf-8");
        res.send(output);

    } catch (err) {
        console.error("❌ 에러:", err);
        res.status(500).send("에러");
    }
});


function escapeXml(str) {
    return str.replace(/[&<>"']/g, function (c) {
        switch (c) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&apos;';
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
    console.log(`📱 사용법: /image?img=1&name=민수&text=안녕하세요&size=28`);
    console.log(`✅ 준비 완료!`);
});
