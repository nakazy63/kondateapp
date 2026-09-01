import React, { useState, useRef, useEffect, useMemo } from "react";

// ---------------------------------------------------------------------------
// トークン（色・タイポグラフィ）
// ---------------------------------------------------------------------------
const COLORS = {
  bg: "#F2ECD8",
  surface: "#FFFDF6",
  surfaceAlt: "#FBF6E8",
  ink: "#2E2A1F",
  inkSoft: "#726A55",
  border: "#E1D6B4",
  green: "#3E6B49",
  greenSoft: "#E4ECDD",
  greenText: "#25452E",
  orange: "#C96A2E",
  orangeSoft: "#F8E4D2",
  orangeText: "#7A3714",
  danger: "#B4432E",
};

const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Nunito+Sans:wght@400;600;700;800&display=swap');";

// ---------------------------------------------------------------------------
// 日付ユーティリティ
// ---------------------------------------------------------------------------
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function pad2(n) {
  return String(n).padStart(2, "0");
}
function formatDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function todayStr() {
  return formatDate(new Date());
}
function formatJPFull(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}
function formatJPShort(dateStr) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}月${d}日`;
}
function recentWindowEntries(history) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);
  const cutoffStr = formatDate(cutoff);
  return history.filter((e) => e.date >= cutoffStr).sort((a, b) => a.date.localeCompare(b.date));
}
function buildAvoidNote(recent) {
  if (!recent.length) return "";
  const lines = recent.map((e) => `- ${e.date}: ${e.title}`).join("\n");
  return `\n\n【直近3日以内に食べた料理】\n${lines}\n上記と同じ料理、同じ主菜の食材の組み合わせ、同じ系統の味付け（例: 同じ調味料をベースにした味付けが続く）にならないよう、ジャンルや味付けを変えて提案してください。`;
}

// ---------------------------------------------------------------------------
// Gemini API 呼び出し
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `あなたは家庭料理のレシピを考える専門家です。
ユーザーが入力した食材（＋家にありそうな調味料・基本調味料は自由に使ってよい）を使って、次の条件を満たす時短レシピを1つ提案してください。

条件:
- 大人2人 + 4歳の子ども1人、合計3人分の分量にすること
- 子どもも食べやすいように、辛味や強い香辛料は控えめにし、必要なら「子ども用は取り分けて〇〇を足す」のような工夫を入れる
- 誤嚥や窒息のリスクがある食材（丸のままのミニトマト、大きな肉塊、硬いナッツなど）は、4歳児向けに切り方や下処理の注意を書く
- 手に入りにくそうな特殊な食材や調味料は使わない。基本的な調味料（塩、こしょう、砂糖、醤油、味噌、油、みりん、酒、コンソメ、ケチャップ、マヨネーズなど）は「持っている前提」で使ってよい
- 提示された食材を主役にすること。全く使わない食材があれば理由もなく無視しない
- 忙しい家庭でも作れる、現実的な手順にする

出力は必ず次のJSON形式のみで返してください。マークダウンのコードブロック（\`\`\`）や前置き・説明文は一切つけないでください。

もしユーザーの入力だけでは料理として成立しない（食材が少なすぎる、食材と読めない等）場合は、次の形式で返してください:
{"type":"clarify","message":"ここに、もう少し食材を教えてほしい旨の短い日本語メッセージ"}

レシピが作れる場合は、次の形式で返してください:
{
  "type": "recipe",
  "title": "料理名",
  "time_minutes": 20,
  "used_ingredients": ["ユーザーが入力した食材のうち使うもの"],
  "ingredients": [
    {"name": "食材名", "amount": "分量（3人分）"}
  ],
  "steps": ["手順1", "手順2", "..."],
  "kid_tip": "4歳児向けの取り分け方や切り方、味の調整についての一言",
  "note": "冷蔵庫にありがちな代用食材や、大人向けのアレンジなど（任意、なければ空文字）"
}`;

const GEMINI_MODEL = "gemini-3.6-flash";

function buildGeminiContents(history) {
  return history
    .filter((m) => m.role === "user" || (m.role === "assistant" && m.status === "done"))
    .map((m) => {
      if (m.role === "user") return { role: "user", parts: [{ text: m.text }] };
      return { role: "model", parts: [{ text: JSON.stringify(m.data) }] };
    });
}

async function callGemini(history, apiKey, avoidNote) {
  if (!apiKey) throw new Error("APIキーが未入力です");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT + (avoidNote || "") }] },
      contents: buildGeminiContents(history),
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  });
  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`Gemini API request failed: ${response.status} ${errBody}`);
  }
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const blockReason = data?.promptFeedback?.blockReason;
    throw new Error(
      blockReason
        ? `応答がブロックされました (reason: ${blockReason})`
        : `応答にテキストが含まれていません: ${JSON.stringify(data).slice(0, 300)}`
    );
  }
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    throw new Error(`JSONの解析に失敗しました: ${cleaned.slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------------------
// アイコン
// ---------------------------------------------------------------------------
function PotIcon({ size = 22, color = COLORS.green }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M4 10h16l-1.2 8.2A2 2 0 0 1 16.83 20H7.17a2 2 0 0 1-1.97-1.8L4 10Z"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M3 10h18" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M8 10c0-2.2 1.8-4 4-4s4 1.8 4 4"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M9 4.5c0 .9-1 .9-1 1.8" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M15 4.5c0 .9-1 .9-1 1.8" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon({ size = 18, color = COLORS.green }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" stroke={color} strokeWidth="1.6" />
      <path d="M3.5 9.5h17" stroke={color} strokeWidth="1.6" />
      <path d="M8 3v4M16 3v4" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// UI パーツ
// ---------------------------------------------------------------------------
function IngredientTags({ items }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
      {items.map((it, i) => (
        <span
          key={i}
          style={{
            fontFamily: "'Nunito Sans', sans-serif",
            fontSize: 13.5,
            fontWeight: 700,
            background: COLORS.ink,
            color: COLORS.surface,
            padding: "5px 12px",
            borderRadius: 999,
          }}
        >
          {it}
        </span>
      ))}
    </div>
  );
}

function LoadingCard() {
  return (
    <div
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        padding: "20px 22px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: `2.5px solid ${COLORS.greenSoft}`,
          borderTopColor: COLORS.green,
          animation: "kondate-spin 0.8s linear infinite",
        }}
      />
      <span style={{ fontFamily: "'Nunito Sans', sans-serif", color: COLORS.inkSoft, fontSize: 14.5 }}>
        今ある食材で、作れるレシピを考えています…
      </span>
    </div>
  );
}

function ClarifyCard({ message }) {
  return (
    <div
      style={{
        background: COLORS.orangeSoft,
        border: `1px solid ${COLORS.orange}33`,
        borderRadius: 14,
        padding: "16px 20px",
        fontFamily: "'Nunito Sans', sans-serif",
        color: COLORS.orangeText,
        fontSize: 14.5,
        lineHeight: 1.7,
      }}
    >
      {message}
    </div>
  );
}

function ErrorCard({ onRetry, detail }) {
  return (
    <div
      style={{
        background: "#FBEAE6",
        border: `1px solid ${COLORS.danger}33`,
        borderRadius: 14,
        padding: "16px 20px",
        fontFamily: "'Nunito Sans', sans-serif",
        color: "#7A2C1D",
        fontSize: 14.5,
        lineHeight: 1.7,
      }}
    >
      うまくレシピを作れませんでした。もう一度試してください。
      {detail && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 10px",
            background: "#F6D9D2",
            borderRadius: 8,
            fontFamily: "monospace",
            fontSize: 12,
            color: "#5C2013",
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
          }}
        >
          {detail}
        </div>
      )}
      <button
        onClick={onRetry}
        style={{
          marginLeft: 10,
          border: "none",
          background: "none",
          color: COLORS.danger,
          fontWeight: 700,
          textDecoration: "underline",
          cursor: "pointer",
          fontFamily: "'Nunito Sans', sans-serif",
          fontSize: 14.5,
        }}
      >
        再試行する
      </button>
    </div>
  );
}

function RecipeCard({ data, recordedDate, onAnother, onRecord }) {
  const [dateValue, setDateValue] = useState(recordedDate || todayStr());

  useEffect(() => {
    if (recordedDate) setDateValue(recordedDate);
  }, [recordedDate]);

  return (
    <div
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      {/* ヘッダー */}
      <div
        style={{
          padding: "20px 24px 16px",
          borderBottom: `1px dashed ${COLORS.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <PotIcon />
          <span
            style={{
              fontFamily: "'Nunito Sans', sans-serif",
              fontSize: 13,
              color: COLORS.inkSoft,
              fontWeight: 700,
            }}
          >
            {data.time_minutes ? `約${data.time_minutes}分` : ""} ・ 大人2人+4歳のお子さん1人分
          </span>
        </div>
        <h2
          style={{
            fontFamily: "'Fraunces', serif",
            fontSize: 26,
            fontWeight: 600,
            color: COLORS.ink,
            margin: 0,
            lineHeight: 1.3,
          }}
        >
          {data.title}
        </h2>
      </div>

      {/* 材料 */}
      <div style={{ padding: "18px 24px 4px" }}>
        <h3
          style={{
            fontFamily: "'Nunito Sans', sans-serif",
            fontSize: 14,
            fontWeight: 800,
            color: COLORS.green,
            margin: "0 0 10px",
          }}
        >
          材料（3人分）
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {(data.ingredients || []).map((ing, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "8px 0",
                borderBottom: i === data.ingredients.length - 1 ? "none" : `1px solid ${COLORS.surfaceAlt}`,
                fontFamily: "'Nunito Sans', sans-serif",
                fontSize: 14.5,
                color: COLORS.ink,
              }}
            >
              <span>{ing.name}</span>
              <span style={{ color: COLORS.inkSoft }}>{ing.amount}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 手順 */}
      <div style={{ padding: "18px 24px 4px" }}>
        <h3
          style={{
            fontFamily: "'Nunito Sans', sans-serif",
            fontSize: 14,
            fontWeight: 800,
            color: COLORS.green,
            margin: "0 0 12px",
          }}
        >
          作り方
        </h3>
        <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {(data.steps || []).map((step, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                gap: 12,
                marginBottom: 12,
                fontFamily: "'Nunito Sans', sans-serif",
                fontSize: 14.5,
                color: COLORS.ink,
                lineHeight: 1.65,
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: COLORS.greenSoft,
                  color: COLORS.greenText,
                  fontWeight: 800,
                  fontSize: 12.5,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 1,
                }}
              >
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* 子ども向けのひとこと */}
      {data.kid_tip && (
        <div style={{ padding: "4px 24px 20px" }}>
          <div
            style={{
              background: COLORS.orangeSoft,
              borderRadius: 12,
              padding: "12px 16px",
              display: "flex",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>🧒</span>
            <p
              style={{
                margin: 0,
                fontFamily: "'Nunito Sans', sans-serif",
                fontSize: 13.5,
                color: COLORS.orangeText,
                lineHeight: 1.65,
              }}
            >
              {data.kid_tip}
            </p>
          </div>
        </div>
      )}

      {data.note && (
        <div style={{ padding: "0 24px 20px" }}>
          <p
            style={{
              margin: 0,
              fontFamily: "'Nunito Sans', sans-serif",
              fontSize: 13,
              color: COLORS.inkSoft,
              lineHeight: 1.6,
            }}
          >
            {data.note}
          </p>
        </div>
      )}

      {/* 作った日を記録 */}
      <div
        style={{
          padding: "16px 24px 20px",
          borderTop: `1px dashed ${COLORS.border}`,
        }}
      >
        <p
          style={{
            margin: "0 0 8px",
            fontFamily: "'Nunito Sans', sans-serif",
            fontSize: 12.5,
            fontWeight: 700,
            color: COLORS.inkSoft,
          }}
        >
          作った日を記録
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="date"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            style={{
              border: `1px solid ${COLORS.border}`,
              borderRadius: 8,
              padding: "6px 10px",
              fontFamily: "'Nunito Sans', sans-serif",
              fontSize: 16,
              color: COLORS.ink,
              background: COLORS.surfaceAlt,
            }}
          />
          <button
            onClick={() => onRecord(dateValue)}
            style={{
              border: "none",
              background: COLORS.green,
              color: "#fff",
              fontFamily: "'Nunito Sans', sans-serif",
              fontWeight: 700,
              fontSize: 12.5,
              padding: "7px 14px",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            {recordedDate ? "更新する" : "記録する"}
          </button>
          {recordedDate && (
            <span
              style={{
                fontFamily: "'Nunito Sans', sans-serif",
                fontSize: 12.5,
                color: COLORS.greenText,
                fontWeight: 700,
              }}
            >
              {formatJPShort(recordedDate)}に記録済み
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: "0 24px 20px" }}>
        <button
          onClick={onAnother}
          style={{
            border: `1px solid ${COLORS.border}`,
            background: COLORS.surfaceAlt,
            color: COLORS.ink,
            fontFamily: "'Nunito Sans', sans-serif",
            fontWeight: 700,
            fontSize: 13.5,
            padding: "8px 16px",
            borderRadius: 999,
            cursor: "pointer",
          }}
        >
          別のレシピにする
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// カレンダー タブ
// ---------------------------------------------------------------------------
const navBtnStyle = {
  border: `1px solid ${COLORS.border}`,
  background: COLORS.surface,
  color: COLORS.ink,
  width: 32,
  height: 32,
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 13,
};

function CalendarTab({ history }) {
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [selectedDate, setSelectedDate] = useState(todayStr());

  const historyByDate = useMemo(() => {
    const map = {};
    history.forEach((e) => {
      (map[e.date] = map[e.date] || []).push(e);
    });
    return map;
  }, [history]);

  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const changeMonth = (delta) => {
    setMonthCursor((prev) => {
      const next = new Date(prev);
      next.setMonth(prev.getMonth() + delta);
      return next;
    });
  };

  const selectedEntries = (historyByDate[selectedDate] || []).slice().sort((a, b) =>
    a.title.localeCompare(b.title)
  );

  return (
    <div style={{ padding: "20px 20px 32px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={() => changeMonth(-1)} style={navBtnStyle} aria-label="前の月">
          ◀
        </button>
        <span
          style={{
            fontFamily: "'Fraunces', serif",
            fontSize: 18,
            fontWeight: 600,
            color: COLORS.ink,
          }}
        >
          {year}年{month + 1}月
        </span>
        <button onClick={() => changeMonth(1)} style={navBtnStyle} aria-label="次の月">
          ▶
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            style={{
              textAlign: "center",
              fontFamily: "'Nunito Sans', sans-serif",
              fontSize: 12,
              color: COLORS.inkSoft,
              fontWeight: 700,
              padding: "4px 0",
            }}
          >
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`blank-${i}`} />;
          const dateStr = formatDate(new Date(year, month, d));
          const has = (historyByDate[dateStr] || []).length > 0;
          const isSelected = dateStr === selectedDate;
          const isToday = dateStr === todayStr();
          return (
            <button
              key={dateStr}
              onClick={() => setSelectedDate(dateStr)}
              style={{
                aspectRatio: "1",
                border: isSelected ? `1.5px solid ${COLORS.green}` : `1px solid ${COLORS.border}`,
                background: isSelected ? COLORS.greenSoft : COLORS.surface,
                borderRadius: 10,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontFamily: "'Nunito Sans', sans-serif",
                padding: 0,
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: isToday ? 800 : 600,
                  color: isSelected ? COLORS.greenText : COLORS.ink,
                }}
              >
                {d}
              </span>
              {has && (
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: COLORS.orange,
                    marginTop: 2,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h3
          style={{
            fontFamily: "'Nunito Sans', sans-serif",
            fontSize: 14,
            fontWeight: 800,
            color: COLORS.green,
            margin: 0,
          }}
        >
          {formatJPFull(selectedDate)}
        </h3>
        {selectedEntries.length === 0 && (
          <p
            style={{
              fontFamily: "'Nunito Sans', sans-serif",
              fontSize: 13.5,
              color: COLORS.inkSoft,
              margin: 0,
            }}
          >
            この日の記録はまだありません。レシピカードの「作った日を記録」から追加できます。
          </p>
        )}
        {selectedEntries.map((e) => (
          <div
            key={e.id}
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: "14px 16px",
            }}
          >
            <p
              style={{
                fontFamily: "'Fraunces', serif",
                fontSize: 17,
                fontWeight: 600,
                color: COLORS.ink,
                margin: "0 0 4px",
              }}
            >
              {e.title}
            </p>
            {e.time_minutes ? (
              <p
                style={{
                  fontFamily: "'Nunito Sans', sans-serif",
                  fontSize: 12.5,
                  color: COLORS.inkSoft,
                  margin: "0 0 8px",
                }}
              >
                約{e.time_minutes}分
              </p>
            ) : null}
            {e.ingredients?.length > 0 && (
              <p
                style={{
                  fontFamily: "'Nunito Sans', sans-serif",
                  fontSize: 13,
                  color: COLORS.ink,
                  margin: 0,
                  lineHeight: 1.6,
                }}
              >
                {e.ingredients.map((ing) => ing.name).join("、")}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// メインアプリ
// ---------------------------------------------------------------------------
function tabButtonStyle(active) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    border: `1px solid ${COLORS.green}`,
    background: active ? COLORS.green : "transparent",
    color: active ? COLORS.surface : COLORS.green,
    fontFamily: "'Nunito Sans', sans-serif",
    fontWeight: 700,
    fontSize: 13,
    padding: "7px 14px",
    borderRadius: 999,
    cursor: "pointer",
  };
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(true);
  const [activeTab, setActiveTab] = useState("chat");
  const [history, setHistory] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  useEffect(() => {
    try {
      const savedKey = localStorage.getItem("gemini-api-key");
      if (savedKey) {
        setApiKey(savedKey);
        setShowKeyInput(false);
      }
    } catch (e) {
      // 読み込みに失敗した場合は通常通り入力を求める
    }
  }, []);

  const saveApiKey = (key) => {
    setApiKey(key);
    try {
      if (key) {
        localStorage.setItem("gemini-api-key", key);
      } else {
        localStorage.removeItem("gemini-api-key");
      }
    } catch (e) {
      console.error("Failed to save API key", e);
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem("recipe-log");
      if (raw) setHistory(JSON.parse(raw));
    } catch (e) {
      // まだ記録がない場合、または読み込みに失敗した場合はここに来る
    }
  }, []);

  const persistHistory = (list) => {
    try {
      localStorage.setItem("recipe-log", JSON.stringify(list));
    } catch (e) {
      console.error("Failed to save recipe log", e);
    }
  };

  const parseIngredients = (text) =>
    text
      .split(/[、,\s\/・]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const runGeneration = async (historyForApi, assistantId) => {
    try {
      const recent = recentWindowEntries(history);
      const avoidNote = buildAvoidNote(recent);
      const data = await callGemini(historyForApi, apiKey, avoidNote);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, status: "done", data } : m))
      );
    } catch (e) {
      console.error("recipe generation failed", e);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, status: "error", errorMessage: e?.message || String(e) }
            : m
        )
      );
    }
  };

  const handleSend = (rawText) => {
    const text = (rawText ?? input).trim();
    if (!text) return;
    if (!apiKey) {
      setShowKeyInput(true);
      return;
    }
    const tags = parseIngredients(text);
    const userMsg = { id: crypto.randomUUID(), role: "user", text, tags };
    const assistantId = crypto.randomUUID();
    const assistantMsg = {
      id: assistantId,
      role: "assistant",
      status: "loading",
      data: null,
      recordedDate: null,
      recordEntryId: null,
    };

    setMessages((prev) => {
      const next = [...prev, userMsg, assistantMsg];
      runGeneration(next.filter((m) => m.id !== assistantId), assistantId);
      return next;
    });
    setInput("");
  };

  const handleRetry = (assistantId) => {
    setMessages((prev) => {
      const next = prev.map((m) => (m.id === assistantId ? { ...m, status: "loading" } : m));
      runGeneration(
        next.filter((m) => m.id !== assistantId),
        assistantId
      );
      return next;
    });
  };

  const handleAnother = (assistantId) => {
    setMessages((prev) => {
      const nudge = {
        id: crypto.randomUUID(),
        role: "user",
        text: "同じ食材で、別のレシピを提案して",
        tags: ["別のレシピ"],
      };
      const newAssistantId = crypto.randomUUID();
      const newAssistant = {
        id: newAssistantId,
        role: "assistant",
        status: "loading",
        data: null,
        recordedDate: null,
        recordEntryId: null,
      };
      const next = [...prev, nudge, newAssistant];
      runGeneration(next.filter((m) => m.id !== newAssistantId), newAssistantId);
      return next;
    });
  };

  const handleRecordDate = (assistantId, date) => {
    const msg = messages.find((m) => m.id === assistantId);
    if (!msg || !msg.data) return;
    const entryId = msg.recordEntryId || crypto.randomUUID();
    const entry = {
      id: entryId,
      date,
      title: msg.data.title,
      time_minutes: msg.data.time_minutes,
      ingredients: msg.data.ingredients || [],
      steps: msg.data.steps || [],
      kid_tip: msg.data.kid_tip || "",
      note: msg.data.note || "",
    };

    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId ? { ...m, recordedDate: date, recordEntryId: entryId } : m
      )
    );

    setHistory((prev) => {
      const next = [...prev.filter((e) => e.id !== entryId), entry].sort((a, b) =>
        a.date.localeCompare(b.date)
      );
      persistHistory(next);
      return next;
    });
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: COLORS.bg,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <style>{`
        ${FONT_IMPORT}
        @keyframes kondate-spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        body { margin: 0; }
        input, textarea { font-size: 16px; }
        ::placeholder { color: ${COLORS.inkSoft}; opacity: 0.7; }
      `}</style>

      <div
        style={{
          width: "100%",
          maxWidth: 560,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* ヘッダー */}
        <div
          style={{
            padding: "22px 20px 16px",
            background: COLORS.bg,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <PotIcon size={26} />
            <h1
              style={{
                fontFamily: "'Fraunces', serif",
                fontSize: 22,
                fontWeight: 600,
                color: COLORS.ink,
                margin: 0,
              }}
            >
              今日のごはん相談
            </h1>
          </div>
          <p
            style={{
              fontFamily: "'Nunito Sans', sans-serif",
              fontSize: 13.5,
              color: COLORS.inkSoft,
              margin: "6px 0 0",
              lineHeight: 1.6,
            }}
          >
            家にある食材を送ると、大人2人＋4歳のお子さん1人分のレシピを考えます。直近3日の記録をもとに、味付けが続かないよう提案します。
          </p>

          {showKeyInput && (
            <div
              style={{
                marginTop: 12,
                background: COLORS.surfaceAlt,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 12,
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Gemini APIキーを入力"
                  style={{
                    flex: 1,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 8,
                    padding: "7px 10px",
                    fontFamily: "'Nunito Sans', sans-serif",
                    fontSize: 16,
                    color: COLORS.ink,
                    background: COLORS.surface,
                    outline: "none",
                  }}
                />
                <button
                  onClick={() => {
                    if (!apiKey) return;
                    saveApiKey(apiKey);
                    setShowKeyInput(false);
                  }}
                  style={{
                    border: "none",
                    background: COLORS.green,
                    color: "#fff",
                    fontFamily: "'Nunito Sans', sans-serif",
                    fontWeight: 700,
                    fontSize: 12.5,
                    padding: "8px 14px",
                    borderRadius: 8,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  保存する
                </button>
              </div>
              <p
                style={{
                  margin: 0,
                  fontFamily: "'Nunito Sans', sans-serif",
                  fontSize: 11.5,
                  color: COLORS.inkSoft,
                  lineHeight: 1.5,
                }}
              >
                この端末のブラウザに保存され、次回からは入力不要になります。共有のPCなどでは保存しないでください。
              </p>
            </div>
          )}
          {!showKeyInput && (
            <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
              <button
                onClick={() => setShowKeyInput(true)}
                style={{
                  border: "none",
                  background: "none",
                  color: COLORS.inkSoft,
                  fontFamily: "'Nunito Sans', sans-serif",
                  fontSize: 12,
                  textDecoration: "underline",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                APIキーを変更する
              </button>
              <button
                onClick={() => {
                  saveApiKey("");
                  setShowKeyInput(true);
                }}
                style={{
                  border: "none",
                  background: "none",
                  color: COLORS.inkSoft,
                  fontFamily: "'Nunito Sans', sans-serif",
                  fontSize: 12,
                  textDecoration: "underline",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                保存したキーを削除
              </button>
            </div>
          )}
        </div>

        {/* タブ切り替え */}
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "4px 20px 14px",
            borderBottom: `1px solid ${COLORS.border}`,
          }}
        >
          <button onClick={() => setActiveTab("chat")} style={tabButtonStyle(activeTab === "chat")}>
            <PotIcon size={15} color={activeTab === "chat" ? COLORS.surface : COLORS.green} />
            レシピ相談
          </button>
          <button
            onClick={() => setActiveTab("calendar")}
            style={tabButtonStyle(activeTab === "calendar")}
          >
            <CalendarIcon size={15} color={activeTab === "calendar" ? COLORS.surface : COLORS.green} />
            カレンダー
          </button>
        </div>

        {/* コンテンツ */}
        {activeTab === "chat" ? (
          <div
            style={{
              padding: "20px 20px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {messages.length === 0 && (
              <div
                style={{
                  background: COLORS.surfaceAlt,
                  border: `1px dashed ${COLORS.border}`,
                  borderRadius: 14,
                  padding: "18px 20px",
                  fontFamily: "'Nunito Sans', sans-serif",
                  fontSize: 14,
                  color: COLORS.inkSoft,
                  lineHeight: 1.7,
                }}
              >
                例えば「にんじん、鶏もも肉、じゃがいも、玉ねぎ」のように、冷蔵庫にある食材を入力してみてください。複数入れるほど提案の幅が広がります。
              </div>
            )}

            {messages.map((m) => {
              if (m.role === "user") {
                return (
                  <div key={m.id} style={{ display: "flex", justifyContent: "flex-end" }}>
                    <IngredientTags items={m.tags} />
                  </div>
                );
              }
              if (m.status === "loading") return <LoadingCard key={m.id} />;
              if (m.status === "error")
                return (
                  <ErrorCard key={m.id} onRetry={() => handleRetry(m.id)} detail={m.errorMessage} />
                );
              if (m.data?.type === "clarify")
                return <ClarifyCard key={m.id} message={m.data.message} />;
              if (m.data?.type === "recipe")
                return (
                  <RecipeCard
                    key={m.id}
                    data={m.data}
                    recordedDate={m.recordedDate}
                    onAnother={() => handleAnother(m.id)}
                    onRecord={(date) => handleRecordDate(m.id, date)}
                  />
                );
              return null;
            })}
            <div ref={bottomRef} />
          </div>
        ) : (
          <div>
            <CalendarTab history={history} />
          </div>
        )}

        {/* 入力バー */}
        {activeTab === "chat" && (
          <div
            style={{
              padding: "14px 20px 20px",
              borderTop: `1px solid ${COLORS.border}`,
              background: COLORS.bg,
              position: "sticky",
              bottom: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 8,
                background: COLORS.surface,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 14,
                padding: 6,
              }}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="にんじん、鶏もも肉、じゃがいも...（Ctrl+Enterで送信）"
                rows={1}
                style={{
                  flex: 1,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  padding: "10px 12px",
                  fontFamily: "'Nunito Sans', sans-serif",
                  fontSize: 16,
                  color: COLORS.ink,
                  resize: "none",
                  maxHeight: 120,
                }}
              />
              <button
                onClick={() => handleSend()}
                style={{
                  border: "none",
                  background: COLORS.green,
                  color: "#fff",
                  fontFamily: "'Nunito Sans', sans-serif",
                  fontWeight: 700,
                  fontSize: 14,
                  padding: "0 20px",
                  borderRadius: 10,
                  cursor: "pointer",
                  alignSelf: "flex-end",
                }}
              >
                送信
              </button>
            </div>
            <p
              style={{
                margin: "6px 4px 0",
                fontFamily: "'Nunito Sans', sans-serif",
                fontSize: 11.5,
                color: COLORS.inkSoft,
              }}
            >
              Enterで改行 ・ Ctrl+Enter(Macは⌘+Enter)で送信
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
  
