"use client";

import { useEffect, useRef, useState } from "react";
import { loadSession } from "@/lib/session";

type LeaderboardEntry = {
  name: string;
  goats: number;
  bestRun: number;
};

type StatsState = {
  goats: number;
  bestRun: number;
  goatLeaderboard: LeaderboardEntry[];
  runLeaderboard: LeaderboardEntry[];
};

type DiceResult = {
  roll?: number[];
  sum?: number;
  payout?: number;
  win?: boolean;
  betType?: BetType;
  betAmount?: number;
  error?: string;
};

type SlotResult = {
  reels?: string[];
  payout?: number;
  win?: boolean;
  multiplier?: number;
  betAmount?: number;
  error?: string;
};

type PlinkoResult = {
  bucket?: string;
  payout?: number;
  win?: boolean;
  multiplier?: number;
  betAmount?: number;
  capped?: boolean;
  cap?: number;
  error?: string;
};

type RunSummary = {
  score: number;
  earned: number;
  bestRun: number;
};

type BetType = "LOW" | "SEVEN" | "HIGH";

const GRAVITY = 1800;
const JUMP_VELOCITY = -720;
const BASE_SPEED = 260;
const SPEED_INCREMENT = 8;
const MIN_GAP = 280;
const MAX_GAP = 520;
const GROUND_HEIGHT = 52;
const GOAT_SIZE = 46;
const MIN_HEIGHT = 280;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const goatScoreFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatGoatScore(value: number) {
  return goatScoreFormatter.format(value);
}

const betInputFormatter = new Intl.NumberFormat("en-US");
const betInputHints = "Try 1b, 2 bil, or 2,500,000.";

function formatBetInput(value: number) {
  if (!Number.isFinite(value)) return "";
  return betInputFormatter.format(Math.max(0, Math.floor(value)));
}

function parseGoatAmount(rawValue: string) {
  const trimmed = rawValue.trim().toLowerCase();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/[, _]/g, "").replace(/goats?/g, "");
  const match = normalized.match(/^(\d+(?:\.\d+)?)([a-z]+)?$/);
  if (match) {
    const base = Number(match[1]);
    if (!Number.isFinite(base)) return null;
    const multipliers: Record<string, number> = {
      k: 1_000,
      m: 1_000_000,
      b: 1_000_000_000,
      bn: 1_000_000_000,
      bil: 1_000_000_000,
      bill: 1_000_000_000,
      billion: 1_000_000_000,
      t: 1_000_000_000_000,
      tril: 1_000_000_000_000,
      trillion: 1_000_000_000_000,
    };
    const suffix = match[2];
    if (!suffix) return Math.floor(base);
    const multiplier = multipliers[suffix];
    if (!multiplier) return null;
    return Math.floor(base * multiplier);
  }

  const numericValue = Number(normalized);
  if (!Number.isFinite(numericValue)) return null;
  return Math.floor(numericValue);
}

const betQuickValues = [
  { label: "1k", value: 1_000 },
  { label: "10k", value: 10_000 },
  { label: "1m", value: 1_000_000 },
  { label: "100m", value: 100_000_000 },
  { label: "1b", value: 1_000_000_000 },
  { label: "2b", value: 2_000_000_000 },
];

type BetAmountInputProps = {
  value: string;
  onChange: (nextValue: string) => void;
  balance: number;
};

function BetAmountInput({ value, onChange, balance }: BetAmountInputProps) {
  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        inputMode="decimal"
        placeholder={betInputHints}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[#d9e5c2] px-3 py-2 text-sm shadow-inner focus:outline-none focus:ring-2 focus:ring-[#a2c867]"
      />
      <div className="flex flex-wrap gap-2 text-xs">
        {betQuickValues.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => onChange(formatBetInput(option.value))}
            className="rounded-full border border-[#d9e5c2] bg-[#f5f9ea] px-3 py-1 font-semibold text-[#4f5d2a] shadow-sm transition hover:bg-[#eaf2d4]"
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(formatBetInput(balance))}
          className="rounded-full border border-[#d9e5c2] bg-white px-3 py-1 font-semibold text-[#3f4a23] shadow-sm transition hover:bg-[#eef3df]"
        >
          Max
        </button>
      </div>
      <div className="text-[11px] text-[#6b744d]">{betInputHints}</div>
    </div>
  );
}

const pipLayout: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [
    [30, 30],
    [70, 70],
  ],
  3: [
    [30, 30],
    [50, 50],
    [70, 70],
  ],
  4: [
    [30, 30],
    [70, 30],
    [30, 70],
    [70, 70],
  ],
  5: [
    [30, 30],
    [70, 30],
    [50, 50],
    [30, 70],
    [70, 70],
  ],
  6: [
    [30, 25],
    [70, 25],
    [30, 50],
    [70, 50],
    [30, 75],
    [70, 75],
  ],
};

const SLOT_SYMBOLS = ["🐐", "🐓", "🐄", "🐑", "🌽", "🥕"] as const;
const PLINKO_BUCKETS: Array<{ label: string; multiplier: number }> = [
  { label: "🌾", multiplier: 0 },
  { label: "🐐", multiplier: 1 },
  { label: "🐓", multiplier: 1.5 },
  { label: "🐑", multiplier: 2 },
  { label: "🐄", multiplier: 3 },
  { label: "🧀", multiplier: 5 },
];
const PLINKO_SPARKLES = [
  { top: "18%", left: "14%", delay: "0s" },
  { top: "32%", left: "78%", delay: "1.2s" },
  { top: "54%", left: "24%", delay: "0.6s" },
  { top: "68%", left: "70%", delay: "1.8s" },
  { top: "40%", left: "48%", delay: "2.4s" },
];

function buildPlinkoPath(targetIndex: number, columns: number) {
  const steps = columns + 6;
  const startCol = Math.floor(columns / 2);
  const path: number[] = [startCol];

  for (let i = 1; i < steps - 1; i++) {
    const current = path[path.length - 1];
    const remaining = steps - i - 1;
    const distance = targetIndex - current;

    const candidates = [-1, 0, 1]
      .map((delta) => clamp(current + delta, 0, columns - 1))
      .filter((pos, idx, arr) => arr.indexOf(pos) === idx)
      .filter((pos) => Math.abs(targetIndex - pos) <= remaining + 1);

    let next = current;
    const preferred = current + Math.sign(distance);
    if (candidates.includes(preferred)) {
      next = preferred;
    } else if (candidates.length) {
      next = candidates[Math.floor(Math.random() * candidates.length)];
    }

    path.push(clamp(next, 0, columns - 1));
  }

  path.push(targetIndex);
  return path;
}

function DiceFace({ value, animate }: { value: number; animate?: boolean }) {
  const clampedValue = Math.max(1, Math.min(6, Math.round(value)));
  const pips = pipLayout[clampedValue] || pipLayout[1];
  return (
    <div
      className={`relative w-16 h-16 rounded-2xl border-2 border-[#d6dfc3] bg-white shadow-[0_10px_30px_rgba(96,117,61,0.12)] flex items-center justify-center transition-transform ${
        animate ? "dice-shake" : "dice-pop"
      }`}
    >
      {pips.map((pip, idx) => (
        <span
          key={`${clampedValue}-${idx}`}
          className="absolute w-3 h-3 rounded-full bg-[#3f4a23] shadow-[0_1px_3px_rgba(0,0,0,0.2)]"
          style={{ left: `${pip[0]}%`, top: `${pip[1]}%`, transform: "translate(-50%, -50%)" }}
        />
      ))}
    </div>
  );
}

export default function GoatArcadePage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const goatYRef = useRef<number>(0);
  const goatVelRef = useRef<number>(0);
  const obstaclesRef = useRef<Array<{ x: number; width: number; height: number }>>([]);
  const speedRef = useRef<number>(BASE_SPEED);
  const scoreRef = useRef<number>(0);
  const statusRef = useRef<"idle" | "running" | "over">("idle");

  const [status, setStatus] = useState<"idle" | "running" | "over">("idle");
  const [score, setScore] = useState<number>(0);
  const [message, setMessage] = useState<string>("Tap or press space to leap fences!");
  const [canvasSize, setCanvasSize] = useState({ width: 760, height: MIN_HEIGHT });
  const [activeGame, setActiveGame] =
    useState<"run" | "dice" | "slots" | "plinko">("run");
  const [name, setName] = useState<string>("");
  const [stats, setStats] = useState<StatsState>({
    goats: 0,
    bestRun: 0,
    goatLeaderboard: [],
    runLeaderboard: [],
  });
  const [loadingStats, setLoadingStats] = useState(false);
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [showLeaders, setShowLeaders] = useState(false);
  const [diceBetType, setDiceBetType] = useState<BetType>("LOW");
  const [diceBetAmount, setDiceBetAmount] = useState<string>("5");
  const [diceResult, setDiceResult] = useState<DiceResult>({});
  const [diceLoading, setDiceLoading] = useState(false);
  const [diceAnimating, setDiceAnimating] = useState(false);
  const [rollingFaces, setRollingFaces] = useState<[number, number]>([1, 1]);
  const [slotsBetAmount, setSlotsBetAmount] = useState<string>("5");
  const [slotsResult, setSlotsResult] = useState<SlotResult>({});
  const [slotsReels, setSlotsReels] = useState<string[]>(["🐐", "🐓", "🐄"]);
  const [slotsSpinning, setSlotsSpinning] = useState(false);
  const [plinkoBetAmount, setPlinkoBetAmount] = useState<string>("5");
  const [plinkoResult, setPlinkoResult] = useState<PlinkoResult>({});
  const [plinkoPath, setPlinkoPath] = useState<number[]>([]);
  const [plinkoDropping, setPlinkoDropping] = useState(false);
  const [plinkoStep, setPlinkoStep] = useState(0);
  const [plinkoOffsets, setPlinkoOffsets] = useState<number[]>([]);

  useEffect(() => {
    const session = loadSession();
    if (session?.name) {
      setName(session.name);
    }
  }, []);

  useEffect(() => {
    if (!name) return;
    void fetchStats();
  }, [name]);

  useEffect(() => {
    const resize = () => {
      if (!wrapperRef.current) return;
      const width = clamp(wrapperRef.current.clientWidth, 360, 960);
      setCanvasSize({ width, height: MIN_HEIGHT });
    };

    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code === "Space" && activeGame === "run") {
        event.preventDefault();
        if (status === "idle" || status === "over") {
          startGame();
        } else {
          jump();
        }
      }
    };

    const handlePointer = () => {
      if (activeGame !== "run") return;
      if (status === "idle" || status === "over") {
        startGame();
      } else {
        jump();
      }
    };

    window.addEventListener("keydown", handleKey);
    window.addEventListener("pointerdown", handlePointer);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("pointerdown", handlePointer);
      stopGame();
    };
  }, [status, activeGame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    drawScene(canvas.getContext("2d"));
  }, [canvasSize]);

  useEffect(() => {
    if (activeGame !== "run") {
      stopGame();
      setStatus("idle");
      setMessage("Tap or press space to leap fences!");
    }
  }, [activeGame]);

  useEffect(() => {
    if (!diceAnimating) {
      if (diceResult.roll && diceResult.roll.length === 2) {
        setRollingFaces([diceResult.roll[0], diceResult.roll[1]]);
      }
      return;
    }

    const id = setInterval(() => {
      setRollingFaces([
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1,
      ]);
    }, 90);

    return () => clearInterval(id);
  }, [diceAnimating, diceResult.roll]);

  const fetchStats = async () => {
    try {
      setLoadingStats(true);
      const res = await fetch("/api/goat-stats", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load stats");
      const data = await res.json();
      const normalized = name.trim().toLowerCase();
      const currentUser = (data.users || []).find(
        (u: LeaderboardEntry) => u.name.trim().toLowerCase() === normalized
      );

      setStats({
        goats: currentUser?.goats ?? 0,
        bestRun: currentUser?.bestRun ?? 0,
        goatLeaderboard: data.goatLeaderboard || [],
        runLeaderboard: data.runLeaderboard || [],
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingStats(false);
    }
  };

  const syncStatsFromPayload = (data: Partial<StatsState> & { goats?: number }) => {
    setStats((prev) => ({
      goats: data.goats ?? prev.goats,
      bestRun: data.bestRun ?? prev.bestRun,
      goatLeaderboard: data.goatLeaderboard || prev.goatLeaderboard,
      runLeaderboard: data.runLeaderboard || prev.runLeaderboard,
    }));
  };

  const jump = () => {
    if (goatYRef.current >= groundY(canvasSize.height)) {
      goatVelRef.current = JUMP_VELOCITY;
    }
  };

  const startGame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    obstaclesRef.current = [];
    speedRef.current = BASE_SPEED;
    scoreRef.current = 0;
    goatYRef.current = groundY(canvasSize.height);
    goatVelRef.current = 0;
    lastTimeRef.current = null;
    statusRef.current = "running";
    setStatus("running");
    setShowLeaders(false);
    setRunSummary(null);
    setMessage("Catch the rhythm and hop the fences!");
    rafRef.current = requestAnimationFrame(step);
  };

  const stopGame = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = null;
    lastTimeRef.current = null;
  };

  const handleGameOver = async () => {
    statusRef.current = "over";
    setStatus("over");
    setMessage("Ouch! Tap start to run again.");
    stopGame();
    const finalScore = Math.floor(scoreRef.current);
    setScore(finalScore);
    setShowLeaders(true);
    setRunSummary({ score: finalScore, earned: 0, bestRun: finalScore });

    if (!name) return;
    try {
      const res = await fetch("/api/goat-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run", name, score: finalScore }),
      });

      if (!res.ok) throw new Error("Failed to record run");
      const data = await res.json();
      setStats((prev) => ({
        goats: data.goats ?? prev.goats,
        bestRun: data.bestRun ?? prev.bestRun,
        goatLeaderboard: data.goatLeaderboard || prev.goatLeaderboard,
        runLeaderboard: data.runLeaderboard || prev.runLeaderboard,
      }));
      setRunSummary({
        score: finalScore,
        earned: data.earned ?? 0,
        bestRun: data.bestRun ?? finalScore,
      });
    } catch (err) {
      console.error(err);
    }
  };

  const step = (timestamp: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    if (lastTimeRef.current === null) {
      lastTimeRef.current = timestamp;
      rafRef.current = requestAnimationFrame(step);
      return;
    }

    const delta = (timestamp - lastTimeRef.current) / 1000;
    lastTimeRef.current = timestamp;

    updatePhysics(delta, canvas.width, canvas.height);
    drawScene(ctx);
    rafRef.current = requestAnimationFrame(step);
  };

  const groundY = (height: number) => height - GROUND_HEIGHT;

  const spawnObstacle = (width: number, height: number, canvasWidth: number) => {
    const last = obstaclesRef.current[obstaclesRef.current.length - 1];
    const gap = MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP);
    const startX = last ? Math.max(canvasWidth, last.x + last.width + gap) : canvasWidth + 120;
    obstaclesRef.current.push({ x: startX, width, height });
  };

  const updatePhysics = (delta: number, canvasWidth: number, canvasHeight: number) => {
    speedRef.current += SPEED_INCREMENT * delta;
    scoreRef.current += delta * 10;
    setScore(Math.floor(scoreRef.current));

    goatVelRef.current += GRAVITY * delta;
    goatYRef.current += goatVelRef.current * delta;

    const ground = groundY(canvasHeight);
    if (goatYRef.current > ground) {
      goatYRef.current = ground;
      goatVelRef.current = 0;
    }

    const shouldSpawn =
      obstaclesRef.current.length === 0 ||
      (obstaclesRef.current[obstaclesRef.current.length - 1]?.x ?? 0) < canvasWidth - MIN_GAP;
    if (shouldSpawn) {
      const height = 40 + Math.random() * 22;
      const width = 36 + Math.random() * 20;
      spawnObstacle(width, height, canvasWidth);
    }

    obstaclesRef.current = obstaclesRef.current
      .map((obstacle) => ({ ...obstacle, x: obstacle.x - speedRef.current * delta }))
      .filter((obstacle) => obstacle.x + obstacle.width > -80);

    if (checkCollision(canvasHeight)) {
      void handleGameOver();
    }
  };

  const checkCollision = (canvasHeight: number) => {
    const goatX = canvasSize.width * 0.14;
    const goatY = goatYRef.current;
    const goatTop = goatY - GOAT_SIZE;
    const goatBottom = goatY;
    const goatLeft = goatX - GOAT_SIZE * 0.3;
    const goatRight = goatX + GOAT_SIZE * 0.5;

    return obstaclesRef.current.some((obs) => {
      const obsTop = canvasHeight - GROUND_HEIGHT - obs.height;
      const obsBottom = canvasHeight - GROUND_HEIGHT;
      const obsLeft = obs.x;
      const obsRight = obs.x + obs.width;

      const overlapX = goatLeft < obsRight && goatRight > obsLeft;
      const overlapY = goatBottom > obsTop && goatTop < obsBottom;
      return overlapX && overlapY;
    });
  };

  const drawScene = (ctx: CanvasRenderingContext2D | null) => {
    if (!ctx) return;
    const { width, height } = canvasSize;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#f7fbff");
    gradient.addColorStop(1, "#d7f3d1");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (let i = 0; i < 4; i++) {
      const cx = (width / 4) * i + (i % 2 === 0 ? 40 : -20);
      const cy = 50 + i * 8;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 60, 22, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const groundTop = height - GROUND_HEIGHT;
    ctx.fillStyle = "#a3cf72";
    ctx.fillRect(0, groundTop, width, GROUND_HEIGHT);
    ctx.fillStyle = "#86b85a";
    for (let i = 0; i < width; i += 26) {
      ctx.fillRect(i, groundTop + 32, 18, 10);
    }

    obstaclesRef.current.forEach((obs) => {
      const obsTop = height - GROUND_HEIGHT - obs.height;
      ctx.fillStyle = "#c28f51";
      ctx.fillRect(obs.x, obsTop, obs.width, obs.height);
      ctx.fillStyle = "#d9b07c";
      ctx.fillRect(obs.x + 4, obsTop + 6, obs.width - 8, obs.height - 12);
      ctx.strokeStyle = "#9d6b3d";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(obs.x, obsTop + obs.height * 0.35);
      ctx.lineTo(obs.x + obs.width, obsTop + obs.height * 0.35);
      ctx.moveTo(obs.x, obsTop + obs.height * 0.7);
      ctx.lineTo(obs.x + obs.width, obsTop + obs.height * 0.7);
      ctx.moveTo(obs.x + obs.width * 0.25, obsTop);
      ctx.lineTo(obs.x + obs.width * 0.25, obsTop + obs.height);
      ctx.moveTo(obs.x + obs.width * 0.5, obsTop);
      ctx.lineTo(obs.x + obs.width * 0.5, obsTop + obs.height);
      ctx.moveTo(obs.x + obs.width * 0.75, obsTop);
      ctx.lineTo(obs.x + obs.width * 0.75, obsTop + obs.height);
      ctx.stroke();
    });

    const goatX = width * 0.14;
    const goatY = goatYRef.current;

    ctx.save();
    ctx.scale(-1, 1);
    ctx.font = `${GOAT_SIZE}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textBaseline = "bottom";
    ctx.fillText("🐐", -(goatX), goatY - 6);
    ctx.restore();

    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.ellipse(goatX + 10, groundTop + 36, 36, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#4f6b2d";
    ctx.font = "16px 'Inter', system-ui, sans-serif";
    ctx.fillText(`Score: ${Math.floor(scoreRef.current)}`, width - 140, 28);
  };

  const handleRoll = async () => {
    if (!name) {
      setDiceResult({ error: "Please log in to play." });
      return;
    }

    const parsedBet = parseGoatAmount(diceBetAmount);
    if (!parsedBet || parsedBet <= 0) {
      setDiceResult({ error: "Enter a valid bet amount (like 2,500,000 or 1b)." });
      return;
    }

    const bet = Math.max(1, Math.floor(parsedBet));
    if (bet > stats.goats) {
      setDiceResult({ error: "Not enough 🐐 for that bet." });
      return;
    }

    setDiceLoading(true);
    setDiceAnimating(true);
    setDiceResult({});
    try {
      const res = await fetch("/api/goat-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "dice",
          name,
          betType: diceBetType,
          betAmount: bet,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDiceResult({ error: data?.error || "Failed to roll" });
        setDiceAnimating(false);
        return;
      }

      syncStatsFromPayload(data);

      setDiceResult({
        roll: data.roll,
        sum: data.sum,
        payout: data.payout,
        win: data.win,
        betType: data.betType,
        betAmount: data.betAmount,
      });
      setTimeout(() => setDiceAnimating(false), 700);
    } catch (err) {
      console.error(err);
      setDiceResult({ error: "Something went wrong." });
      setDiceAnimating(false);
    } finally {
      setDiceLoading(false);
    }
  };

  const handleSlotsSpin = async () => {
    if (!name) {
      setSlotsResult({ error: "Please log in to play." });
      return;
    }

    const parsedBet = parseGoatAmount(slotsBetAmount);
    if (!parsedBet || parsedBet <= 0) {
      setSlotsResult({ error: "Enter a valid bet amount (like 2,500,000 or 1b)." });
      return;
    }

    const bet = Math.max(1, Math.floor(parsedBet));
    if (bet > stats.goats) {
      setSlotsResult({ error: "Not enough 🐐 for that bet." });
      return;
    }

    setSlotsResult({});
    setSlotsSpinning(true);
    const spinInterval = setInterval(() => {
      setSlotsReels([
        SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
        SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
        SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
      ]);
    }, 100);

    try {
      const res = await fetch("/api/goat-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "slots", name, betAmount: bet }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSlotsResult({ error: data?.error || "Failed to spin" });
        return;
      }

      setSlotsReels(data.reels || slotsReels);
      syncStatsFromPayload(data);
      setSlotsResult({
        reels: data.reels,
        payout: data.payout,
        win: data.win,
        multiplier: data.multiplier,
        betAmount: data.betAmount,
      });
    } catch (err) {
      console.error(err);
      setSlotsResult({ error: "Something went wrong." });
    } finally {
      clearInterval(spinInterval);
      setSlotsSpinning(false);
    }
  };

  const handlePlinkoDrop = async () => {
    if (!name) {
      setPlinkoResult({ error: "Please log in to play." });
      return;
    }

    const parsedBet = parseGoatAmount(plinkoBetAmount);
    if (!parsedBet || parsedBet <= 0) {
      setPlinkoResult({ error: "Enter a valid bet amount (like 2,500,000 or 2 bil)." });
      return;
    }

    const bet = Math.max(1, Math.floor(parsedBet));
    if (bet > stats.goats) {
      setPlinkoResult({ error: "Not enough 🐐 for that bet." });
      return;
    }

    setPlinkoResult({});
    setPlinkoDropping(true);
    setPlinkoPath([]);
    setPlinkoStep(0);
    setPlinkoOffsets([]);

    let stepTimeout: ReturnType<typeof setTimeout> | null = null;

    try {
      const res = await fetch("/api/goat-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "plinko", name, betAmount: bet }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPlinkoResult({ error: data?.error || "Failed to drop" });
        setPlinkoDropping(false);
        return;
      }

      syncStatsFromPayload(data);
      const targetIndex = Math.max(
        0,
        PLINKO_BUCKETS.findIndex((bucket) => bucket.label === data.bucket)
      );
      const columns = PLINKO_BUCKETS.length;
      const path = buildPlinkoPath(targetIndex, columns);
      const offsets = path.map((_, idx) => {
        const variance = idx === 0 || idx === path.length - 1 ? 0.2 : 0.9;
        return (Math.random() - 0.5) * variance * 2;
      });
      setPlinkoPath(path);
      setPlinkoOffsets(offsets);
      const steps = path.length;

      let step = 0;
      const scheduleStep = () => {
        step += 1;
        setPlinkoStep(step);
        if (step < path.length - 1) {
          const travel = step / Math.max(path.length - 1, 1);
          const delay = 90 + Math.sin(travel * Math.PI) * 90 + Math.random() * 25;
          stepTimeout = setTimeout(scheduleStep, delay);
        }
      };
      stepTimeout = setTimeout(scheduleStep, 120);

      setTimeout(() => {
      setPlinkoResult({
        bucket: data.bucket,
        payout: data.payout,
        win: data.win,
        multiplier: data.multiplier,
        betAmount: data.betAmount,
        capped: data.capped,
        cap: data.cap,
      });
        setPlinkoDropping(false);
        if (stepTimeout) clearTimeout(stepTimeout);
        setPlinkoStep(path.length - 1);
      }, steps * 180);
    } catch (err) {
      console.error(err);
      setPlinkoResult({ error: "Something went wrong." });
      setPlinkoDropping(false);
      if (stepTimeout) clearTimeout(stepTimeout);
    }
  };

  const displayDice: [number, number] = diceAnimating
    ? rollingFaces
    : diceResult.roll && diceResult.roll.length === 2
    ? [diceResult.roll[0], diceResult.roll[1]]
    : rollingFaces;

  const resolvedSum = diceResult.sum ??
    (diceResult.roll && diceResult.roll.length === 2
      ? diceResult.roll[0] + diceResult.roll[1]
      : undefined);

  const diceBetPreview = parseGoatAmount(diceBetAmount);
  const slotsBetPreview = parseGoatAmount(slotsBetAmount);
  const plinkoBetPreview = parseGoatAmount(plinkoBetAmount);
  const diceBetFallback = diceBetPreview ? formatBetInput(diceBetPreview) : "--";
  const slotsBetFallback = slotsBetPreview ? formatBetInput(slotsBetPreview) : "--";
  const plinkoBetFallback = plinkoBetPreview ? formatBetInput(plinkoBetPreview) : "--";

  const betOptions: { key: BetType; label: string }[] = [
    { key: "LOW", label: "LOW (2-6)" },
    { key: "SEVEN", label: "SEVEN" },
    { key: "HIGH", label: "HIGH (8-12)" },
  ];

  const gameArea = () => {
    if (activeGame === "run") {
      return (
        <div className="rounded-2xl bg-white shadow-lg p-4 sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2 text-[#4f5d2a]">
                <span className="text-xl">🌿</span>
                <span className="text-sm sm:text-base font-medium">
                  Tap start or press space. Jump with space or tap.
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="px-3 py-1 rounded-full bg-[#f2f6e6] text-xs font-semibold text-[#4f5d2a] shadow-inner">
                  Score: {score}
                </div>
                <button
                  onClick={startGame}
                  className="rounded-full bg-[#a2c867] text-white px-4 py-2 text-sm font-semibold shadow-md hover:bg-[#8db153] transition-colors"
                >
                  {status === "running" ? "Restart" : "Start"}
                </button>
              </div>
            </div>
            <div ref={wrapperRef} className="relative w-full">
              <canvas
                ref={canvasRef}
                className="w-full rounded-xl border border-[#d9e5c2] bg-[#eaf5dd] shadow-inner touch-pan-y"
              />
              {status !== "running" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-white/70 backdrop-blur-[1px] text-center px-6">
                  <div className="text-5xl mb-3">🐐</div>
                  <p className="text-base sm:text-lg font-semibold text-[#3f4a23]">{message}</p>
                  <p className="text-sm text-[#65734c] mt-2">Press space on desktop or tap anywhere to hop.</p>
                  {showLeaders && (
                    <div className="mt-4 w-full max-w-xl text-left">
                      <div className="flex items-center justify-between text-xs text-[#4f5d2a] font-semibold mb-2">
                        <span>Top Goat Runners</span>
                        <span>Best</span>
                      </div>
                      <div className="bg-white/80 rounded-lg shadow-inner divide-y divide-[#e3ebd2] max-h-48 overflow-y-auto">
                        {stats.runLeaderboard.map((entry, idx) => (
                          <div key={entry.name} className="flex items-center justify-between px-3 py-2 text-sm">
                            <span className="flex items-center gap-2">
                              <span className="text-[#8db153] font-semibold">#{idx + 1}</span>
                              {entry.name}
                            </span>
                            <span className="font-semibold text-[#3f4a23]">{entry.bestRun}</span>
                          </div>
                        ))}
                        {stats.runLeaderboard.length === 0 && (
                          <div className="px-3 py-2 text-sm text-[#6b744d]">No runs yet.</div>
                        )}
                      </div>
                      {runSummary && (
                        <div className="mt-3 text-sm text-[#3f4a23]">
                          <p>
                            You scored <strong>{runSummary.score}</strong> and gathered 🐐{runSummary.earned}. Best: {runSummary.bestRun}.
                          </p>
                          <p className="text-xs text-[#6b744d] mt-1">Every 200 points adds one 🐐 to Goat Dice.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="text-xs text-[#6b744d] text-center">
              Leaving this page pauses the run until you hop back in. 200 points = 1 goat for Goat Dice.
            </div>
          </div>
        </div>
      );
    }

    if (activeGame === "dice") {
      return (
        <div className="rounded-2xl bg-white shadow-lg p-4 sm:p-5 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[#3b4224]">Goat Dice</h2>
              <p className="text-sm text-[#556133]">Bet your 🐐 on LOW (2-6), SEVEN, or HIGH (8-12). SEVEN pays five 🐐 for every one you wager; the others double you up.</p>
            </div>
            <div className="px-3 py-1 rounded-full bg-[#f2f6e6] text-xs font-semibold text-[#4f5d2a] shadow-inner">
              Balance: 🐐 {stats.goats}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-3">
              <label className="text-sm font-semibold text-[#3f4a23]">Bet amount</label>
              <BetAmountInput value={diceBetAmount} onChange={setDiceBetAmount} balance={stats.goats} />
              <div className="text-xs text-[#6b744d]">Bet is deducted on roll. Winnings are added immediately to your 🐐 pile.</div>
            </div>
            <div className="flex flex-col gap-3">
              <label className="text-sm font-semibold text-[#3f4a23]">Pick your fate</label>
              <div className="flex flex-wrap gap-2">
                {betOptions.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setDiceBetType(opt.key)}
                    className={`rounded-full px-3 py-2 text-sm font-semibold transition shadow ${
                      diceBetType === opt.key
                        ? "bg-[#a2c867] text-white shadow-md"
                        : "bg-[#f2f6e6] text-[#4f5d2a] hover:bg-[#e5efc8]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <button
                onClick={handleRoll}
                disabled={diceLoading}
                className="rounded-full bg-[#3f4a23] text-white px-4 py-2 text-sm font-semibold shadow hover:bg-[#2f3618] disabled:opacity-60"
              >
                {diceLoading ? "Rolling..." : "Roll the Dice"}
              </button>
              {diceResult.error && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {diceResult.error}
                </div>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-[#d9e5c2] bg-[#f9fbf2] p-4 shadow-inner">
            <div className="flex items-center justify-between text-sm text-[#3f4a23] font-semibold">
              <span>Outcome</span>
              <span className="text-[#6b744d]">Multiplier: LOW/HIGH 2x, SEVEN 5x</span>
            </div>
            <div className="mt-4 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex items-center justify-center gap-3 md:w-52">
                <DiceFace value={displayDice[0]} animate={diceAnimating} />
                <DiceFace value={displayDice[1]} animate={diceAnimating} />
              </div>
              <div className="flex-1 grid sm:grid-cols-3 gap-3 text-sm text-[#3f4a23]">
                <div className="flex flex-col items-center gap-1 bg-white/90 rounded-lg p-3 shadow">
                  <span className="text-xs uppercase tracking-[0.12em] text-[#6b744d]">Sum</span>
                  <span className="text-2xl font-bold">{resolvedSum ?? "--"}</span>
                </div>
                <div className="flex flex-col items-center gap-1 bg-white/90 rounded-lg p-3 shadow">
                  <span className="text-xs uppercase tracking-[0.12em] text-[#6b744d]">Bet</span>
                  <span className="text-base font-semibold">
                    🐐 {diceResult.betAmount ?? (diceLoading ? "..." : "--")}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-1 bg-white/90 rounded-lg p-3 shadow">
                  <span className="text-xs uppercase tracking-[0.12em] text-[#6b744d]">Payout</span>
                  <span className={`text-2xl font-bold ${diceResult.win ? "text-[#3f7d2e]" : "text-[#a12f2f]"}`}>
                    {diceResult.win === undefined
                      ? "--"
                      : diceResult.win
                      ? `+🐐${diceResult.payout}`
                      : `-🐐${diceResult.betAmount ?? 0}`}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#d9e5c2] bg-[#f4f8ea] p-4 shadow-inner text-sm text-[#3f4a23]">
            <div className="font-semibold text-[#2f3618] mb-3">How to play Goat Dice</div>
            <div className="grid sm:grid-cols-2 gap-3">
              {["Place a bet and pick LOW (2-6), SEVEN, or HIGH (8-12).", "Two dice roll together. LOW/HIGH pay 2x; SEVEN pays 5x.", "Winnings pop right back into your 🐐 balance when you win.", "Treat it like a cozy farm game and enjoy the rolls!"]
                .map((tip) => (
                  <div
                    key={tip}
                    className="flex items-start gap-2 rounded-lg bg-white/80 border border-[#e3ebd2] p-3 shadow-sm"
                  >
                    <span className="text-xl" aria-hidden>
                      🐐
                    </span>
                    <span className="leading-snug">{tip}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      );
    }

    if (activeGame === "slots") {
      const reelGlow = slotsSpinning ? "slot-spin" : "";
      return (
        <div className="rounded-2xl bg-white shadow-lg p-4 sm:p-5 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[#3b4224]">Farm Slots</h2>
              <p className="text-sm text-[#556133]">Spin the barn reels with your 🐐. Triple goats jackpot pays 8x, other triples pay 5x, pairs pay 2x, and goat plus corn gives 1.5x.</p>
            </div>
            <div className="px-3 py-1 rounded-full bg-[#f2f6e6] text-xs font-semibold text-[#4f5d2a] shadow-inner">
              Balance: 🐐 {stats.goats}
            </div>
          </div>

          <div className="rounded-xl border border-[#d9e5c2] bg-gradient-to-b from-[#f7fbf1] to-[#e7f1d7] p-4 shadow-inner">
            <div className="flex items-center justify-between text-sm text-[#3f4a23] font-semibold mb-3">
              <span>Lucky reels</span>
              <span className="text-[#6b744d]">Tap Spin to roll the farm friends</span>
            </div>
            <div className="flex items-center justify-center gap-3 sm:gap-4">
              {slotsReels.map((symbol, idx) => (
                <div
                  key={`${symbol}-${idx}-${slotsSpinning}`}
                  className={`w-20 h-24 sm:w-24 sm:h-28 rounded-2xl bg-white shadow-[0_12px_30px_rgba(96,117,61,0.18)] border border-[#d9e5c2] flex items-center justify-center text-4xl sm:text-5xl ${reelGlow}`}
                >
                  {symbol}
                </div>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-3">
              <label className="text-sm font-semibold text-[#3f4a23]">Bet amount</label>
              <BetAmountInput value={slotsBetAmount} onChange={setSlotsBetAmount} balance={stats.goats} />
              <div className="text-xs text-[#6b744d]">Bet is placed on spin. Winnings return right away.</div>
            </div>
            <div className="flex flex-col gap-3">
              <label className="text-sm font-semibold text-[#3f4a23]">Ready to spin?</label>
              <button
                onClick={handleSlotsSpin}
                disabled={slotsSpinning}
                className="rounded-full bg-[#3f4a23] text-white px-4 py-2 text-sm font-semibold shadow hover:bg-[#2f3618] disabled:opacity-60"
              >
                {slotsSpinning ? "Spinning..." : "Spin the reels"}
              </button>
              {slotsResult.error && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {slotsResult.error}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[#d9e5c2] bg-[#f9fbf2] p-4 shadow-inner grid sm:grid-cols-3 gap-3 text-sm text-[#3f4a23]">
            <div className="flex flex-col items-center gap-1 bg-white/90 rounded-lg p-3 shadow">
              <span className="text-xs uppercase tracking-[0.12em] text-[#6b744d]">Bet</span>
              <span className="text-base font-semibold">🐐 {slotsResult.betAmount ?? (slotsSpinning ? "..." : slotsBetFallback)}</span>
            </div>
            <div className="flex flex-col items-center gap-1 bg-white/90 rounded-lg p-3 shadow">
              <span className="text-xs uppercase tracking-[0.12em] text-[#6b744d]">Multiplier</span>
              <span className="text-2xl font-bold">{slotsResult.multiplier ? `${slotsResult.multiplier}x` : "--"}</span>
            </div>
            <div className="flex flex-col items-center gap-1 bg-white/90 rounded-lg p-3 shadow">
              <span className="text-xs uppercase tracking-[0.12em] text-[#6b744d]">Payout</span>
              <span className={`text-2xl font-bold ${slotsResult.win ? "text-[#3f7d2e]" : "text-[#a12f2f]"}`}>
                {slotsResult.win === undefined
                  ? "--"
                  : slotsResult.win
                  ? `+🐐${slotsResult.payout}`
                  : `-🐐${slotsResult.betAmount ?? slotsBetFallback}`}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-[#d9e5c2] bg-[#f4f8ea] p-4 shadow-inner text-sm text-[#3f4a23]">
            <div className="font-semibold text-[#2f3618] mb-3">How to play Farm Slots</div>
            <div className="grid sm:grid-cols-2 gap-3">
              {["Pick your bet and tap Spin to shuffle the farm icons.", "Three goats pay 8x, other triples pay 5x, any pair pays 2x, and a goat with corn pays 1.5x.", "Your bet is deducted on spin. Winnings hop right back to your balance.", "Enjoy the barn lights and keep it cozy—play for fun!"]
                .map((tip) => (
                  <div
                    key={tip}
                    className="flex items-start gap-2 rounded-lg bg-white/80 border border-[#e3ebd2] p-3 shadow-sm"
                  >
                    <span className="text-xl" aria-hidden>
                      🐐
                    </span>
                    <span className="leading-snug">{tip}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      );
    }

    const activeBucket = PLINKO_BUCKETS.find((b) => b.label === plinkoResult.bucket);
    const plinkoColumn = plinkoPath[plinkoStep] ?? Math.floor(PLINKO_BUCKETS.length / 2);
    const plinkoOffset = plinkoOffsets[plinkoStep] ?? 0;
    const plinkoTravel =
      plinkoPath.length > 1 ? plinkoStep / Math.max(plinkoPath.length - 1, 1) : 0;
    const plinkoWobble = plinkoDropping ? Math.sin(plinkoStep * 1.4) * 7 : 0;
    const plinkoScale = plinkoDropping ? 1 + Math.sin(plinkoTravel * Math.PI) * 0.06 : 1;
    return (
      <div className="rounded-2xl bg-white shadow-lg p-4 sm:p-5 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#3b4224]">Goat Plinko</h2>
            <p className="text-sm text-[#556133]">Drop a glowing token through the farm pegs. Buckets range from 0x to 5x, with cozy odds favoring the middle.</p>
          </div>
          <div className="px-3 py-1 rounded-full bg-[#f2f6e6] text-xs font-semibold text-[#4f5d2a] shadow-inner">
            Balance: 🐐 {stats.goats}
          </div>
        </div>

        <div className="rounded-xl border border-[#d9e5c2] bg-gradient-to-b from-[#f7fbf1] to-[#e7f1d7] p-4 shadow-inner plinko-board">
          <div className="flex items-center justify-between text-sm text-[#3f4a23] font-semibold mb-3">
            <span>Plinko board</span>
            <span className="text-[#6b744d]">Tap Drop to send your token</span>
          </div>
          <div className="relative h-64 bg-white/70 rounded-xl overflow-hidden border border-[#d9e5c2] shadow-inner">
            {PLINKO_SPARKLES.map((sparkle, idx) => (
              <span
                key={`sparkle-${idx}`}
                className="absolute w-3 h-3 rounded-full plinko-sparkle"
                style={{
                  top: sparkle.top,
                  left: sparkle.left,
                  animationDelay: sparkle.delay,
                }}
              />
            ))}
            {Array.from({ length: PLINKO_BUCKETS.length + 1 }).map((_, rowIdx) => (
              <div
                key={`row-${rowIdx}`}
                className="absolute left-0 right-0"
                style={{ top: `${(rowIdx / (PLINKO_BUCKETS.length + 1)) * 70 + 10}%` }}
              >
                <div className="flex justify-center gap-4">
                  {PLINKO_BUCKETS.map((bucket, colIdx) => (
                    <span
                      key={`${bucket.label}-${colIdx}-${rowIdx}`}
                      className="w-3 h-3 rounded-full bg-[#c1d8a6] shadow plinko-peg"
                      style={{ animationDelay: `${(rowIdx + colIdx) * 0.08}s` }}
                    />
                  ))}
                </div>
              </div>
            ))}

            <div
              className={`absolute w-9 h-9 rounded-full flex items-center justify-center text-2xl shadow-lg transition-all duration-200 ease-out plinko-token ${
                plinkoDropping ? "bg-white" : "bg-[#f9fbf2]"
              }`}
              style={{
                left: `${(((plinkoColumn + 0.5) / PLINKO_BUCKETS.length) * 100 + plinkoOffset).toFixed(2)}%`,
                top: `${(plinkoTravel * 74 + 6).toFixed(2)}%`,
                transform: `translate(-50%, -50%) rotate(${plinkoWobble}deg) scale(${plinkoScale})`,
              }}
            >
              🐐
            </div>

            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="relative w-full h-[88%]">
                {Array.from({ length: Math.max(PLINKO_BUCKETS.length + 1, 6) }).map(
                  (_, rowIdx) => {
                    const cols = PLINKO_BUCKETS.length;
                    return Array.from({ length: cols }).map((__, colIdx) => {
                      const offset = rowIdx % 2 === 0 ? 0.5 : 0;
                      const left = (((colIdx + offset) / cols) * 100).toFixed(2);
                      const top = ((rowIdx / (PLINKO_BUCKETS.length + 1)) * 78 + 4).toFixed(2);
                      return (
                        <span
                          key={`${rowIdx}-${colIdx}`}
                          className="absolute w-2 h-2 rounded-full bg-[#cdd8b2] shadow-sm plinko-peg"
                          style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${rowIdx * 0.06}s` }}
                        />
                      );
                    });
                  }
                )}
              </div>
            </div>

            <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-3">
              {PLINKO_BUCKETS.map((bucket) => (
                <div
                  key={bucket.label}
                  className={`flex flex-col items-center px-3 py-2 rounded-lg border shadow-sm ${
                    bucket.label === activeBucket?.label
                      ? "bg-[#dcedc2] border-[#b7d08a]"
                      : "bg-white/90 border-[#d9e5c2]"
                  }`}
                >
                  <span className="text-lg">{bucket.label}</span>
                  <span className="text-xs text-[#3f4a23] font-semibold">{bucket.multiplier}x</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-3">
            <label className="text-sm font-semibold text-[#3f4a23]">Bet amount</label>
            <BetAmountInput value={plinkoBetAmount} onChange={setPlinkoBetAmount} balance={stats.goats} />
            <div className="text-xs text-[#6b744d]">Bet is deducted on drop. Winnings add back instantly.</div>
          </div>
          <div className="flex flex-col gap-3">
            <label className="text-sm font-semibold text-[#3f4a23]">Drop the token</label>
            <button
              onClick={handlePlinkoDrop}
              disabled={plinkoDropping}
              className="rounded-full bg-[#3f4a23] text-white px-4 py-2 text-sm font-semibold shadow hover:bg-[#2f3618] disabled:opacity-60"
            >
              {plinkoDropping ? "Falling..." : "Drop now"}
            </button>
            {plinkoResult.error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {plinkoResult.error}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[#d9e5c2] bg-[#f9fbf2] p-4 shadow-inner grid sm:grid-cols-3 gap-3 text-sm text-[#3f4a23]">
          <div className="flex flex-col items-center gap-1 bg-white/90 rounded-lg p-3 shadow">
            <span className="text-xs uppercase tracking-[0.12em] text-[#6b744d]">Bet</span>
            <span className="text-base font-semibold">🐐 {plinkoResult.betAmount ?? (plinkoDropping ? "..." : plinkoBetFallback)}</span>
          </div>
          <div className="flex flex-col items-center gap-1 bg-white/90 rounded-lg p-3 shadow">
            <span className="text-xs uppercase tracking-[0.12em] text-[#6b744d]">Bucket</span>
            <span className="text-lg font-semibold">{plinkoResult.bucket || "--"}</span>
          </div>
          <div className="flex flex-col items-center gap-1 bg-white/90 rounded-lg p-3 shadow">
            <span className="text-xs uppercase tracking-[0.12em] text-[#6b744d]">Payout</span>
            <span className={`text-2xl font-bold ${plinkoResult.win ? "text-[#3f7d2e]" : "text-[#a12f2f]"}`}>
              {plinkoResult.win === undefined
              ? "--"
              : plinkoResult.win
              ? `+🐐${plinkoResult.payout}`
              : `-🐐${plinkoResult.betAmount ?? plinkoBetFallback}`}
            </span>
          </div>
        </div>
        {plinkoResult.capped && (
          <div className="text-xs text-[#6b744d] bg-[#f4f8ea] border border-[#d9e5c2] rounded-lg px-3 py-2">
            The barn ledger tops out near 🐐 {formatGoatScore(plinkoResult.cap ?? 0)}. Your win is safely capped so the stats stay stable.
          </div>
        )}

        <div className="rounded-xl border border-[#d9e5c2] bg-[#f4f8ea] p-4 shadow-inner text-sm text-[#3f4a23]">
          <div className="font-semibold text-[#2f3618] mb-3">How to play Goat Plinko</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {["Set a bet and drop the token to bounce through the pegs.", "Each bucket has its own multiplier from 0x up to 5x.", "Bet is taken on drop. Any winnings add back to your 🐐 balance right away.", "Enjoy the soft bounces and celebrate cozy wins!"]
              .map((tip) => (
                <div
                  key={tip}
                  className="flex items-start gap-2 rounded-lg bg-white/80 border border-[#e3ebd2] p-3 shadow-sm"
                >
                  <span className="text-xl" aria-hidden>
                    🐐
                  </span>
                  <span className="leading-snug">{tip}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-white shadow flex items-center justify-center text-3xl">🐐</div>
          <div>
            <h1 className="text-2xl font-semibold text-[#3b4224]">Goat Arcade</h1>
            <p className="text-sm text-[#556133]">
              Hop fences for glory or roll the dice for extra 🐐. Every 200 Run points adds one 🐐 to Goat Dice.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap text-xs text-[#4f5d2a]">
          <span className="px-3 py-1 rounded-full bg-white/80 shadow-inner font-semibold">
            Balance: 🐐 {loadingStats ? "..." : stats.goats}
          </span>
          <span className="px-3 py-1 rounded-full bg-white/80 shadow-inner font-semibold">
            Best Run: {loadingStats ? "..." : stats.bestRun}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "run", label: "Goat Run" },
            { key: "dice", label: "Goat Dice" },
            { key: "slots", label: "Farm Slots" },
            { key: "plinko", label: "Goat Plinko" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveGame(tab.key)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition shadow ${
              activeGame === tab.key
                ? "bg-[#a2c867] text-white shadow-md"
                : "bg-white text-[#4f5d2a] hover:bg-[#f2f6e6]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">{gameArea()}</div>
        <div className="rounded-2xl bg-white shadow-lg p-4 sm:p-5 flex flex-col gap-4">
          <div>
            <h3 className="text-lg font-semibold text-[#3b4224]">Leaderboards</h3>
            <p className="text-xs text-[#6b744d]">Top Goat Dice balances and Goat Run highs.</p>
          </div>
          <div className="grid grid-cols-1 gap-4">
                <div className="rounded-xl border border-[#d9e5c2] bg-[#f9fbf2] p-3 shadow-inner">
                  <div className="flex items-center justify-between text-sm font-semibold text-[#3f4a23] mb-2">
                    <span>Goat Dice</span>
                    <span>🐐</span>
                  </div>
                  <div className="divide-y divide-[#e3ebd2]">
                    {stats.goatLeaderboard.map((entry, idx) => (
                      <div key={entry.name} className="flex items-center justify-between py-2 text-sm text-[#3f4a23]">
                        <span className="flex items-center gap-2">
                          <span className="text-[#8db153] font-semibold">#{idx + 1}</span>
                          {entry.name}
                        </span>
                        <span className="font-semibold">🐐 {formatGoatScore(entry.goats)}</span>
                      </div>
                    ))}
                {stats.goatLeaderboard.length === 0 && (
                  <div className="py-2 text-sm text-[#6b744d]">No Goat Dice games yet.</div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[#d9e5c2] bg-[#f9fbf2] p-3 shadow-inner">
              <div className="flex items-center justify-between text-sm font-semibold text-[#3f4a23] mb-2">
                <span>Goat Run</span>
                <span>Best</span>
              </div>
              <div className="divide-y divide-[#e3ebd2]">
                {stats.runLeaderboard.map((entry, idx) => (
                  <div key={entry.name} className="flex items-center justify-between py-2 text-sm text-[#3f4a23]">
                    <span className="flex items-center gap-2">
                      <span className="text-[#8db153] font-semibold">#{idx + 1}</span>
                      {entry.name}
                    </span>
                    <span className="font-semibold">{entry.bestRun}</span>
                  </div>
                ))}
                {stats.runLeaderboard.length === 0 && (
                  <div className="py-2 text-sm text-[#6b744d]">No runs recorded yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <style jsx global>{`
        @keyframes dice-shake {
          0% { transform: translate(0, 0) rotate(0deg); }
          20% { transform: translate(-2px, -2px) rotate(-6deg); }
          40% { transform: translate(3px, 2px) rotate(4deg); }
          60% { transform: translate(-3px, 1px) rotate(-3deg); }
          80% { transform: translate(2px, -2px) rotate(5deg); }
          100% { transform: translate(0, 0) rotate(0deg); }
        }

        @keyframes dice-pop {
          0% { transform: scale(0.94); }
          60% { transform: scale(1.04); }
          100% { transform: scale(1); }
        }

        .dice-shake {
          animation: dice-shake 0.6s ease;
        }

        .dice-pop {
          animation: dice-pop 0.4s ease;
        }

        @keyframes slot-spin {
          0% { transform: translateY(0) scale(0.98); }
          50% { transform: translateY(-4px) scale(1.02); }
          100% { transform: translateY(0) scale(0.98); }
        }

        .slot-spin {
          animation: slot-spin 0.6s ease-in-out infinite;
        }

        @keyframes plinko-glow {
          0% { box-shadow: 0 0 0 rgba(146, 188, 90, 0.25); }
          50% { box-shadow: 0 0 18px rgba(146, 188, 90, 0.45); }
          100% { box-shadow: 0 0 0 rgba(146, 188, 90, 0.25); }
        }

        @keyframes plinko-peg {
          0% { transform: scale(1); opacity: 0.75; }
          50% { transform: scale(1.18); opacity: 1; }
          100% { transform: scale(1); opacity: 0.8; }
        }

        @keyframes plinko-shimmer {
          0% { opacity: 0.2; transform: translateY(-10%); }
          50% { opacity: 0.45; transform: translateY(0%); }
          100% { opacity: 0.2; transform: translateY(10%); }
        }

        @keyframes plinko-sparkle {
          0% { transform: scale(0.4); opacity: 0; }
          40% { transform: scale(1); opacity: 0.75; }
          70% { transform: scale(0.7); opacity: 0.4; }
          100% { transform: scale(0.2); opacity: 0; }
        }

        .plinko-token {
          animation: plinko-glow 1.4s ease-in-out infinite;
          will-change: transform, left, top;
        }

        .plinko-board {
          position: relative;
          overflow: hidden;
        }

        .plinko-board::before {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.7), transparent 45%),
            radial-gradient(circle at 80% 0%, rgba(173, 214, 120, 0.35), transparent 40%),
            radial-gradient(circle at 50% 90%, rgba(255, 255, 255, 0.45), transparent 50%);
          pointer-events: none;
          animation: plinko-shimmer 6s ease-in-out infinite;
          mix-blend-mode: screen;
        }

        .plinko-peg {
          animation: plinko-peg 2.8s ease-in-out infinite;
        }

        .plinko-sparkle {
          background: radial-gradient(circle, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.1));
          box-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
          animation: plinko-sparkle 3.2s ease-in-out infinite;
          filter: blur(0.2px);
          opacity: 0;
        }
      `}</style>
    </div>
  );
}
