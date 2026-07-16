export type Point = [number, number];

// Largest-Triangle-Three-Buckets downsampling. Keeps visual shape of dense series.
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

    // average point of the next bucket
    let avgX = 0, avgY = 0;
    const avgStart = Math.round((i + 1) * bucketSize);
    const avgEnd = Math.min(Math.round((i + 2) * bucketSize), n);
    const avgCount = Math.max(1, avgEnd - avgStart);
    for (let j = avgStart; j < avgEnd; j++) { avgX += points[j][0]; avgY += points[j][1]; }
    avgX /= avgCount; avgY /= avgCount;

    // pick the point in this bucket forming the largest triangle with a and avg
    let maxArea = -1, chosen = bucketStart;
    const [ax, ay] = points[a];
    for (let j = bucketStart; j < bucketEnd; j++) {
      if (j === a || j >= n) continue;
      const area = Math.abs((ax - avgX) * (points[j][1] - ay) - (ax - points[j][0]) * (avgY - ay));
      if (area > maxArea) { maxArea = area; chosen = j; }
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
