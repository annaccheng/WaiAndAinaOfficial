import { NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase";

type LeaderboardEntry = {
  name: string;
  goats: number;
  bestRun: number;
};

type GoatStatsRow = {
  id: string;
  display_name: string;
  goats: number | null;
  best_run: number | null;
};

const DEFAULT_LEADERBOARD_LIMIT = 8;
const MAX_GOATS = 2_147_483_647;

const selectFields = "id,display_name,goats,best_run";

const normalizeEntry = (row: GoatStatsRow): LeaderboardEntry => ({
  name: row.display_name,
  goats: Number(row.goats || 0),
  bestRun: Number(row.best_run || 0),
});

const rollDice = () => [
  Math.floor(Math.random() * 6) + 1,
  Math.floor(Math.random() * 6) + 1,
];

const SLOT_SYMBOLS = ["🐐", "🐓", "🐄", "🐑", "🌽", "🥕"] as const;
const PLINKO_BUCKETS: Array<{ label: string; multiplier: number; weight: number }> = [
  { label: "🌾", multiplier: 0, weight: 1 },
  { label: "🐐", multiplier: 1, weight: 2 },
  { label: "🐓", multiplier: 1.5, weight: 3 },
  { label: "🐑", multiplier: 2, weight: 4 },
  { label: "🐄", multiplier: 3, weight: 3 },
  { label: "🧀", multiplier: 5, weight: 2 },
];

function pickWeightedBucket() {
  const total = PLINKO_BUCKETS.reduce((sum, bucket) => sum + bucket.weight, 0);
  const roll = Math.random() * total;
  let acc = 0;
  for (const bucket of PLINKO_BUCKETS) {
    acc += bucket.weight;
    if (roll <= acc) return bucket;
  }
  return PLINKO_BUCKETS[0];
}

function buildLeaderboards(rows: GoatStatsRow[]) {
  const entries = rows.map(normalizeEntry);
  const goatLeaderboard = [...entries]
    .sort((a, b) => b.goats - a.goats)
    .slice(0, DEFAULT_LEADERBOARD_LIMIT);
  const runLeaderboard = [...entries]
    .sort((a, b) => b.bestRun - a.bestRun)
    .slice(0, DEFAULT_LEADERBOARD_LIMIT);
  return { goatLeaderboard, runLeaderboard };
}

function clampGoats(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.floor(value), 0), MAX_GOATS);
}

async function loadAllUsers() {
  return supabaseRequest<GoatStatsRow[]>("users", {
    query: { select: selectFields },
  });
}

async function loadUserByName(name: string) {
  return supabaseRequest<GoatStatsRow[]>("users", {
    query: { select: selectFields, display_name: `ilike.${name}`, limit: 1 },
  });
}

export async function GET() {
  try {
    const rows = await loadAllUsers();
    const { goatLeaderboard, runLeaderboard } = buildLeaderboards(rows || []);
    return NextResponse.json({
      users: (rows || []).map(normalizeEntry),
      goatLeaderboard,
      runLeaderboard,
    });
  } catch (err) {
    console.error("Failed to load goat stats:", err);
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: {
    action?: "run" | "dice" | "slots" | "plinko";
    name?: string;
    score?: number;
    betType?: "LOW" | "SEVEN" | "HIGH";
    betAmount?: number;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  const name = body.name?.trim();

  if (!action || !name) {
    return NextResponse.json({ error: "Missing action or name" }, { status: 400 });
  }

  try {
    const rows = await loadUserByName(name);
    const user = rows?.[0];
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const currentGoats = Number(user.goats || 0);
    const currentBestRun = Number(user.best_run || 0);
    let nextGoats = currentGoats;
    let nextBestRun = currentBestRun;
    const payload: Record<string, unknown> = {};

    if (action === "run") {
      const score = Math.max(0, Math.floor(Number(body.score || 0)));
      const earned = Math.floor(score / 200);
      nextGoats = currentGoats + earned;
      nextBestRun = Math.max(currentBestRun, score);
      payload.earned = earned;
      payload.bestRun = nextBestRun;
    } else {
      const betAmount = Math.max(1, Math.floor(Number(body.betAmount || 0)));
      if (betAmount > currentGoats) {
        return NextResponse.json({ error: "Not enough goats" }, { status: 400 });
      }

      if (action === "dice") {
        const roll = rollDice();
        const sum = roll[0] + roll[1];
        const betType = body.betType || "LOW";
        const isLow = sum >= 2 && sum <= 6;
        const isHigh = sum >= 8 && sum <= 12;
        const win =
          (betType === "LOW" && isLow) ||
          (betType === "HIGH" && isHigh) ||
          (betType === "SEVEN" && sum === 7);
        const multiplier = betType === "SEVEN" ? 5 : 2;
        const payout = win ? betAmount * multiplier : 0;
        nextGoats = currentGoats - betAmount + payout;
        payload.roll = roll;
        payload.sum = sum;
        payload.win = win;
        payload.betType = betType;
        payload.betAmount = betAmount;
        payload.payout = payout;
      }

      if (action === "slots") {
        const reels = [
          SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
          SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
          SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
        ];
        let multiplier = 0;
        const [a, b, c] = reels;
        if (a === b && b === c) {
          multiplier = a === "🐐" ? 8 : 5;
        } else if (a === b || b === c || a === c) {
          multiplier = 2;
        } else if (reels.includes("🐐") && reels.includes("🌽")) {
          multiplier = 1.5;
        }
        const payout = multiplier ? Math.floor(betAmount * multiplier) : 0;
        const win = payout > 0;
        nextGoats = currentGoats - betAmount + payout;
        payload.reels = reels;
        payload.multiplier = multiplier;
        payload.payout = payout;
        payload.win = win;
        payload.betAmount = betAmount;
      }

      if (action === "plinko") {
        const bucket = pickWeightedBucket();
        const payout = bucket.multiplier ? Math.floor(betAmount * bucket.multiplier) : 0;
        const win = payout > 0;
        nextGoats = currentGoats - betAmount + payout;
        payload.bucket = bucket.label;
        payload.multiplier = bucket.multiplier;
        payload.payout = payout;
        payload.win = win;
        payload.betAmount = betAmount;
      }
    }

    const clampedGoats = clampGoats(nextGoats);
    if (clampedGoats !== nextGoats) {
      payload.capped = true;
      payload.cap = MAX_GOATS;
    }
    nextGoats = clampedGoats;

    await supabaseRequest("users", {
      method: "PATCH",
      query: { id: `eq.${user.id}` },
      body: {
        goats: nextGoats,
        best_run: nextBestRun,
      },
    });

    const allUsers = await loadAllUsers();
    const { goatLeaderboard, runLeaderboard } = buildLeaderboards(allUsers || []);

    return NextResponse.json({
      goats: nextGoats,
      bestRun: nextBestRun,
      goatLeaderboard,
      runLeaderboard,
      ...payload,
    });
  } catch (err) {
    console.error("Failed to update goat stats:", err);
    return NextResponse.json({ error: "Failed to update stats" }, { status: 500 });
  }
}
