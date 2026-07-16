<script lang="ts">
  import { onMount } from "svelte";
  import { fetchMetrics, type MetricMeta } from "./lib/api.js";
  let metrics: MetricMeta[] = [];
  onMount(async () => { metrics = await fetchMetrics(); });
</script>

<h1>Eco Metric Visualizer</h1>
<p>{metrics.length} metrics available.</p>
