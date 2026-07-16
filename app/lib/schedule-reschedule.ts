type LessonSlot = {
  id?: number;
  date: string;
  startTime: string;
  endTime: string;
  status?: string;
};

export type RescheduleCandidate = {
  candidateId: string;
  date: string;
  startTime: string;
  endTime: string;
  mode: string;
  location: string;
};

const dayMs = 86_400_000;

function minutes(value: string) {
  const matched = /^(\d{2}):(\d{2})$/.exec(value);
  if (!matched) return Number.NaN;
  return Number(matched[1]) * 60 + Number(matched[2]);
}

function clock(value: number) {
  const hour = Math.floor(value / 60), minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + days * dayMs).toISOString().slice(0, 10);
}

function overlaps(candidate: Pick<LessonSlot, "date" | "startTime" | "endTime">, occupied: LessonSlot) {
  return occupied.status !== "cancelled" && occupied.date === candidate.date && occupied.startTime < candidate.endTime && occupied.endTime > candidate.startTime;
}

export function buildRescheduleCandidates(original: LessonSlot & { mode?: string; location?: string }, occupied: LessonSlot[], today: string, limit = 8): RescheduleCandidate[] {
  const start = minutes(original.startTime), end = minutes(original.endTime), duration = end - start;
  if (!original.date || !Number.isFinite(start) || !Number.isFinite(end) || duration <= 0) return [];
  const candidates: Array<RescheduleCandidate & { score: number }> = [];
  const seen = new Set<string>();
  const offsets = [0, -60, 60, -120, 120];
  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const date = shiftDate(original.date, dayOffset);
    if (!date || date < today) continue;
    for (const timeOffset of offsets) {
      const nextStart = start + timeOffset, nextEnd = nextStart + duration;
      if (nextStart < 8 * 60 || nextEnd > 21 * 60 + 30) continue;
      const startTime = clock(nextStart), endTime = clock(nextEnd);
      if (date === original.date && startTime === original.startTime && endTime === original.endTime) continue;
      const candidateId = `${date}_${startTime.replace(":", "")}_${endTime.replace(":", "")}`;
      if (seen.has(candidateId) || occupied.some((item) => overlaps({ date, startTime, endTime }, item))) continue;
      seen.add(candidateId);
      candidates.push({ candidateId, date, startTime, endTime, mode: String(original.mode || "offline"), location: String(original.location || ""), score: dayOffset * 100 + Math.abs(timeOffset) });
    }
  }
  return candidates.sort((a, b) => a.score - b.score || a.candidateId.localeCompare(b.candidateId)).slice(0, Math.max(1, limit)).map((item) => ({ candidateId: item.candidateId, date: item.date, startTime: item.startTime, endTime: item.endTime, mode: item.mode, location: item.location }));
}
