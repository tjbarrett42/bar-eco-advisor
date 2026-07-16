export type Point = [number, number | null];

// Largest-Triangle-Three-Buckets downsampling. Keeps visual shape of dense series.
// null y-values represent data gaps and are preserved in the output without producing NaN.
export function lttb(points: Point[], maxPoints: number): Point[] {
  const n = points.length;
  if (maxPoints < 3 || n <= maxPoints) return points;

  const sampled: Point[] = [points[0]];
  const bucketSize = (n - 1) / (maxPoints - 1);
  let a = 0; // index of last selected point

  for (let i = 1; i < maxPoints - 1; i++) {
    const bucketStart = Math.round(i * bucketSize);
    const bucketEnd = Math.round((i + 1) * bucketSize);

    if (bucketStart >= bucketEnd) {
      // Skip empty buckets
      continue;
    }

    // average point of the next bucket — skip null y-values when averaging
    let avgX = 0, avgY = 0;
    const avgStart = Math.round((i + 1) * bucketSize);
    const avgEnd = Math.min(Math.round((i + 2) * bucketSize), n);
    let avgCount = 0;
    for (let j = avgStart; j < avgEnd; j++) {
      const yj = points[j][1];
      if (yj != null) { avgX += points[j][0]; avgY += yj; avgCount++; }
    }
    if (avgCount > 0) { avgX /= avgCount; avgY /= avgCount; }
    // If avgCount === 0, avgX/avgY remain 0 — area calc degrades gracefully

    // Anchor y: treat null as 0 for triangle-area math (avoids NaN near gaps)
    const [ax, ay] = points[a];
    const aY = ay ?? 0;

    // pick the point in this bucket forming the largest triangle with a and avg
    let maxArea = -1, chosen = bucketStart;
    let hasFiniteCandidate = false;
    for (let j = bucketStart; j < bucketEnd; j++) {
      if (j === a || j >= n) continue;
      const yj = points[j][1];
      if (yj == null) continue; // skip nulls in area selection
      hasFiniteCandidate = true;
      const area = Math.abs((ax - avgX) * (yj - aY) - (ax - points[j][0]) * (avgY - aY));
      if (area > maxArea) { maxArea = area; chosen = j; }
    }

    // If the bucket had only null y-values, emit the first point of the bucket to preserve gap
    if (!hasFiniteCandidate) {
      chosen = bucketStart;
    }

    if (chosen !== a) {
      sampled.push(points[chosen]);
      a = chosen;
    }
  }

  if (a !== n - 1) {
    sampled.push(points[n - 1]);
  }
  return sampled;
}
