"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type CandlestickData,
  type LineData,
  type HistogramData,
  type Time,
  AreaSeries,
} from "lightweight-charts";
import type { YahooBar } from "@/lib/actions/yahoo-finance.actions";

// ── Helpers: compute TA series from Yahoo bars ───────────────────────

function toTime(bar: YahooBar): Time {
  // Yahoo bars have `date: Date | string`. Normalise to YYYY-MM-DD.
  const d = typeof bar.date === "string" ? new Date(bar.date) : bar.date;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}` as Time;
}

function sma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period - 1) {
      result.push(sum / period);
      sum -= values[i - period + 1];
    } else {
      result.push(null);
    }
  }
  return result;
}

function ema(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const result: (number | null)[] = [];
  let prev: number | null = null;
  // Start EMA with SMA
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i === period - 1) {
      prev = sum / period;
      result.push(prev);
    } else if (i > period - 1) {
      prev = values[i] * k + prev! * (1 - k);
      result.push(prev);
    } else {
      result.push(null);
    }
  }
  return result;
}

function rsi(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    if (i <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        result[i] = 100 - 100 / (1 + rs);
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result[i] = 100 - 100 / (1 + rs);
    }
  }
  return result;
}

function bb(
  values: number[],
  period: number,
  mult: number,
): {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
} {
  const middle = sma(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const m = middle[i]!;
    const variance = slice.reduce((sum, v) => sum + (v - m) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    upper[i] = m + mult * std;
    lower[i] = m - mult * std;
  }
  return { upper, middle, lower };
}

function macdSeries(values: number[]): {
  macdLine: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
} {
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const macdLine: (number | null)[] = values.map((_, i) =>
    ema12[i] != null && ema26[i] != null ? ema12[i]! - ema26[i]! : null,
  );
  const signal: (number | null)[] = ema(
    macdLine.filter((v): v is number => v != null),
    9,
  );
  // Pad signal to align with macdLine
  let signalIdx = 0;
  const signalAligned: (number | null)[] = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] != null) {
      signalAligned.push(signal[signalIdx++] ?? null);
    } else {
      signalAligned.push(null);
    }
  }
  const hist: (number | null)[] = macdLine.map((v, i) =>
    v != null && signalAligned[i] != null ? v - signalAligned[i]! : null,
  );
  return { macdLine, signal: signalAligned, hist };
}

function kdjSeries(
  highs: number[],
  lows: number[],
  closes: number[],
): { k: (number | null)[]; d: (number | null)[]; j: (number | null)[] } {
  const n = 9;
  const kArr: (number | null)[] = new Array(closes.length).fill(null);
  const dArr: (number | null)[] = new Array(closes.length).fill(null);
  const jArr: (number | null)[] = new Array(closes.length).fill(null);
  let k = 50;
  let d = 50;
  for (let i = n - 1; i < closes.length; i++) {
    const slice = highs.slice(i - n + 1, i + 1);
    const hh = Math.max(...slice);
    const ll = Math.min(...lows.slice(i - n + 1, i + 1));
    const range = hh - ll;
    const rsv = range > 0 ? ((closes[i] - ll) / range) * 100 : 50;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    kArr[i] = k;
    dArr[i] = d;
    jArr[i] = 3 * k - 2 * d;
  }
  return { k: kArr, d: dArr, j: jArr };
}

// ── Component ────────────────────────────────────────────────────────

interface Props {
  bars: YahooBar[];
  symbol: string;
}

export default function LightweightChart({ bars, symbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || bars.length === 0) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    // ── Prepare data ──────────────────────────────────────────────────
    const closes = bars
      .map((b) => b.close)
      .filter((v): v is number => v !== null) as number[];
    const highs = bars
      .map((b) => b.high)
      .filter((v): v is number => v !== null) as number[];
    const lows = bars
      .map((b) => b.low)
      .filter((v): v is number => v !== null) as number[];
    const volumes = bars
      .map((b) => b.volume)
      .filter((v): v is number => v !== null) as number[];

    // Only use bars that have valid OHLC
    const validBars = bars.filter(
      (b) =>
        b.open != null && b.high != null && b.low != null && b.close != null,
    );

    const times = validBars.map(toTime);
    const candleData: CandlestickData[] = validBars.map((b, i) => ({
      time: times[i],
      open: b.open!,
      high: b.high!,
      low: b.low!,
      close: b.close!,
    }));

    // Compute TA series (using full closes/highs/lows including nulls for alignment)
    const sma5 = sma(closes, 5);
    const sma10 = sma(closes, 10);
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const sma200 = sma(closes, 200);
    const bbData = bb(closes, 20, 2);
    const rsi7 = rsi(closes, 7);
    const rsi14 = rsi(closes, 14);
    const rsi21 = rsi(closes, 21);
    const macdData = macdSeries(closes);
    const kdjData = kdjSeries(highs, lows, closes);

    // ── Create chart ──────────────────────────────────────────────────
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "#0a0a0a" },
        textColor: "#888",
      },
      grid: {
        vertLines: { color: "#1a1a1a" },
        horzLines: { color: "#1a1a1a" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "#333" },
      timeScale: { borderColor: "#333", timeVisible: true },
    });

    // ── Pane 0: Candlestick + SMAs + Bollinger (main price pane) ──────
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      title: symbol,
    });
    candleSeries.setData(candleData);
    candleSeries
      .priceScale()
      .applyOptions({ scaleMargins: { top: 0.05, bottom: 0.3 } });

    // Pane heights via stretch factor (5:2:2:2 ratio)
    const panes = chart.panes();
    panes[0].setStretchFactor(6);

    // SMAs — overlay on pane 0
    const smaLabels = ["SMA(5)", "SMA(10)", "SMA(20)", "SMA(50)", "SMA(200)"];
    const smaColors = ["#f59e0b", "#f97316", "#3b82f6", "#a855f7", "#ec4899"];
    const smaArrays = [sma5, sma10, sma20, sma50, sma200];
    const validTimes = validBars.map((_, i) => times[i]);

    smaArrays.forEach((arr, idx) => {
      const lineData: LineData[] = [];
      validBars.forEach((_, i) => {
        if (arr[i] != null)
          lineData.push({ time: validTimes[i], value: arr[i]! });
      });
      if (lineData.length > 0) {
        const s = chart.addSeries(LineSeries, {
          color: smaColors[idx],
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: smaLabels[idx],
        });
        s.setData(lineData);
      }
    });

    // Bollinger Bands — same pane
    const bbUpperData: LineData[] = [];
    const bbMidData: LineData[] = [];
    const bbLowerData: LineData[] = [];
    validBars.forEach((_, i) => {
      if (bbData.upper[i] != null) {
        bbUpperData.push({ time: validTimes[i], value: bbData.upper[i]! });
        bbMidData.push({ time: validTimes[i], value: bbData.middle[i]! });
        bbLowerData.push({ time: validTimes[i], value: bbData.lower[i]! });
      }
    });
    if (bbUpperData.length > 0) {
      const bbU = chart.addSeries(LineSeries, {
        color: "#ffffff",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        title: "BB Upper",
      });
      bbU.setData(bbUpperData);
      const bbL = chart.addSeries(LineSeries, {
        color: "#ffffff",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        title: "BB Lower",
      });
      bbL.setData(bbLowerData);
      const bbM = chart.addSeries(LineSeries, {
        color: "#d1d5db",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        title: "BB Mid",
      });
      bbM.setData(bbMidData);
    }

    // ── Pane 1: Volume (overlay in lower portion of price pane) ────────
    const volData: HistogramData[] = [];
    validBars.forEach((b, i) => {
      if (b.volume != null) {
        const up = b.close! >= b.open!;
        volData.push({
          time: validTimes[i],
          value: b.volume,
          color: up ? "#22c55e50" : "#ef444450",
        });
      }
    });
    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volSeries.setData(volData);
    volSeries
      .priceScale()
      .applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    // ── Pane 1: MACD (separate pane with explicit height) ──────────────
    chart.addPane();
    const p1 = chart.panes();
    p1[1].setStretchFactor(1);

    const macdLineData: LineData[] = [];
    const macdSigData: LineData[] = [];
    const macdHistData: HistogramData[] = [];
    validBars.forEach((_, i) => {
      const t = validTimes[i];
      if (macdData.macdLine[i] != null)
        macdLineData.push({ time: t, value: macdData.macdLine[i]! });
      if (macdData.signal[i] != null)
        macdSigData.push({ time: t, value: macdData.signal[i]! });
      if (macdData.hist[i] != null) {
        const v = macdData.hist[i]!;
        macdHistData.push({
          time: t,
          value: v,
          color: v >= 0 ? "#22c55e50" : "#ef444450",
        });
      }
    });
    const macdLineS = chart.addSeries(
      LineSeries,
      {
        color: "#3b82f6",
        lineWidth: 1,
        priceLineVisible: false,
        // lastValueVisible: false,
        title: "MACD",
      },
      1,
    );
    macdLineS.setData(macdLineData);
    // MACD center line at 0 — white, no label
    if (validTimes.length > 0) {
      chart
        .addSeries(
          LineSeries,
          {
            color: "#ffffff30",
            lineWidth: 1,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: false,
          },
          1,
        )
        .setData([
          { time: validTimes[0], value: 0 },
          { time: validTimes[validTimes.length - 1], value: 0 },
        ]);
    }
    const macdSigS = chart.addSeries(
      LineSeries,
      {
        color: "#f59e0b",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "Signal",
      },
      1,
    );
    macdSigS.setData(macdSigData);
    chart.addSeries(HistogramSeries, {}, 1).setData(macdHistData);

    // ── Pane 2: RSI (7, 14, 21) with 30/70 levels ──────────────────────
    chart.addPane();
    const p2 = chart.panes();
    p2[2].setStretchFactor(1);

    const rsiColors = ["#f59e0b", "#a855f7", "#3b82f6"];
    const rsiData = [
      { data: rsi7, label: "RSI(7)" },
      { data: rsi14, label: "RSI(14)" },
      { data: rsi21, label: "RSI(21)" },
    ];

    rsiData.forEach(({ data, label }, idx) => {
      const lineData: LineData[] = [];
      validBars.forEach((_, i) => {
        if (data[i] != null)
          lineData.push({ time: validTimes[i], value: data[i]! });
      });
      if (lineData.length > 0) {
        chart
          .addSeries(
            LineSeries,
            {
              color: rsiColors[idx],
              lineWidth: 1,
              priceLineVisible: false,
              lastValueVisible: true,
              title: label,
            },
            2,
          )
          .setData(lineData);
      }
    });

    // Reference lines at 30, 50, 70
    const rsiRef30: LineData[] = [];
    const rsiRef50: LineData[] = [];
    const rsiRef70: LineData[] = [];
    validBars.forEach((_, i) => {
      if (rsi14[i] != null) {
        rsiRef30.push({ time: validTimes[i], value: 30 });
        rsiRef50.push({ time: validTimes[i], value: 50 });
        rsiRef70.push({ time: validTimes[i], value: 70 });
      }
    });
    chart
      .addSeries(
        AreaSeries,
        {
          lineColor: "#ef4444",
          topColor: "#ef444440",
          bottomColor: "transparent",
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        2,
      )
      .setData(rsiRef70);
    chart
      .addSeries(
        AreaSeries,
        {
          lineColor: "#ffffff30",
          topColor: "transparent",
          bottomColor: "transparent",
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        2,
      )
      .setData(rsiRef50);
    chart
      .addSeries(
        AreaSeries,
        {
          lineColor: "#22c55e",
          topColor: "#22c55e40",
          bottomColor: "transparent",
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        2,
      )
      .setData(rsiRef30);

    // ── Pane 3: KDJ (9,3,3) with 0/50/100 levels ───────────────────────
    chart.addPane();
    const p3 = chart.panes();
    p3[3].setStretchFactor(1);

    const kData: LineData[] = [];
    const dData: LineData[] = [];
    const jData: LineData[] = [];
    const kdjRef0: LineData[] = [];
    const kdjRef50: LineData[] = [];
    const kdjRef100: LineData[] = [];
    validBars.forEach((_, i) => {
      if (kdjData.k[i] != null) {
        kData.push({ time: validTimes[i], value: kdjData.k[i]! });
        dData.push({ time: validTimes[i], value: kdjData.d[i]! });
        jData.push({ time: validTimes[i], value: kdjData.j[i]! });
        kdjRef0.push({ time: validTimes[i], value: 0 });
        kdjRef50.push({ time: validTimes[i], value: 50 });
        kdjRef100.push({ time: validTimes[i], value: 100 });
      }
    });
    chart
      .addSeries(
        LineSeries,
        {
          color: "#3b82f6",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          title: "KDJ",
        },
        3,
      )
      .setData(kData);
    chart
      .addSeries(
        LineSeries,
        {
          color: "#f59e0b",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          title: "D",
        },
        3,
      )
      .setData(dData);
    chart
      .addSeries(
        LineSeries,
        {
          color: "#a855f7",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          title: "J",
        },
        3,
      )
      .setData(jData);
    chart
      .addSeries(
        LineSeries,
        {
          color: "#ffffff15",
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        3,
      )
      .setData(kdjRef100);
    chart
      .addSeries(
        LineSeries,
        {
          color: "#ffffff15",
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        3,
      )
      .setData(kdjRef50);
    chart
      .addSeries(
        LineSeries,
        {
          color: "#ffffff15",
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        3,
      )
      .setData(kdjRef0);

    chart.timeScale().fitContent();
    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [bars]);

  return (
    <div className="w-full rounded-xl border border-gray-800 bg-gray-950 p-2">
      <div className="mb-2 flex items-center gap-4 px-2 text-[11px] font-medium uppercase tracking-wider text-gray-500">
        <span>{symbol} — 1 Day Timeframe</span>
      </div>
      <div className="relative">
        <div ref={containerRef} className="h-[600px] w-full" />
      </div>
    </div>
  );
}
