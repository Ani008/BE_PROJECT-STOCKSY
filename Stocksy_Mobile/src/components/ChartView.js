import React, { useMemo, useRef, useState, useEffect } from "react";
import { View, StyleSheet, ActivityIndicator, Text } from "react-native";
import { WebView } from "react-native-webview";

import { Colors, fontScale, moderateScale } from "../theme";

/**
 * ChartView — TradingView Lightweight Charts (Apache-2.0, self-hosted, free)
 * Credit: https://www.tradingview.com/lightweight-charts/
 *
 * Renders OUR OWN OHLC/tick data — nothing is pulled from TradingView's
 * servers, so there's no symbol-resolution step and nothing to fall back
 * to a default ticker.
 *
 * Props:
 *   candles     array    — [{ time, open, high, low, close, volume }]
 *   livePrice   number   — current ltp, updates the last candle/point live
 *   isPositive  boolean  — true = green, false = red
 *   loading     boolean  — show spinner
 *   height      number   — chart height (default 220)
 *   chartType   string   — "area" (compact card, default) | "candles" (full OHLC + volume)
 *   showVolume  boolean  — show volume histogram pane (candles mode only, default true)
 */
const ChartView = ({
  candles = [],
  livePrice = null,
  isPositive = true,
  loading = false,
  height = 220,
  chartType = "area",
  showVolume = true,
}) => {
  const lineColor    = isPositive ? Colors.success : Colors.danger;
  const areaTopColor = isPositive ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)";
  const areaBotColor = isPositive ? "rgba(16,185,129,0.0)"  : "rgba(239,68,68,0.0)";

  const upColor   = Colors.success;
  const downColor = Colors.danger;

  const webViewRef = useRef(null);
  const [webViewLoaded, setWebViewLoaded] = useState(false);

  // Area mode: collapse to close-only line data
  const lineJSON = useMemo(() => {
    if (chartType !== "area") return "[]";
    const points = candles.map((c) => ({ time: c.time, value: c.close }));
    return JSON.stringify(points);
  }, [candles, chartType]);

  // Candle mode: full OHLC data
  const candleJSON = useMemo(() => {
    if (chartType !== "candles") return "[]";
    return JSON.stringify(
      candles.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
  }, [candles, chartType]);

  // Candle mode: colored volume series
  const volumeJSON = useMemo(() => {
    if (chartType !== "candles" || !showVolume) return "[]";
    return JSON.stringify(
      candles.map((c) => ({
        time: c.time,
        value: c.volume ?? 0,
        color:
          c.close >= c.open
            ? "rgba(16,185,129,0.5)"
            : "rgba(239,68,68,0.5)",
      })),
    );
  }, [candles, chartType, showVolume]);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
  <style>
    * { margin: 0; padding: 0; box-sizing:border-box; }
    html, body {
      width:100%; height:100vh;
      background:transparent;
      overflow:hidden;
    }
    #chart { width:100%; height:100%; }
    #msg {
      display:flex; align-items:center; justify-content:center;
      height:100%; font-family:sans-serif; font-size:13px;
      color:#94A3B8; text-align:center; padding:16px;
    }
  </style>
</head>
<body>
  <div id="msg">Loading chart...</div>
  <div id="chart" style="display:none"></div>

  <script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>

  <script>
    var pollCount = 0;
    var poll = setInterval(function() {
      pollCount++;
      if (typeof LightweightCharts !== 'undefined') {
        clearInterval(poll);
        init();
      } else if (pollCount > 60) {
        clearInterval(poll);
        document.getElementById('msg').innerText = 'Chart library failed to load.';
      }
    }, 150);

    var chartType = '${chartType}';
    var mainSeries = null;
    var volumeSeries = null;

    function init() {
      try {
        var lineData   = ${lineJSON};
        var candleData = ${candleJSON};
        var volumeData = ${volumeJSON};

        var hasData = chartType === 'candles' ? candleData.length > 0 : lineData.length > 0;
        if (!hasData) {
          document.getElementById('msg').innerText = 'No data yet. Market may be closed.';
          return;
        }

        document.getElementById('msg').style.display = 'none';
        document.getElementById('chart').style.display = 'block';

        var chart = LightweightCharts.createChart(document.getElementById('chart'), {
          width: window.innerWidth,
          height: window.innerHeight,
          layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: '#94A3B8',
            fontSize: 10,
          },
          grid: {
            vertLines: { visible: false },
            horzLines: { visible: chartType === 'candles', color: 'rgba(148,163,184,0.08)' },
          },
          crosshair: {
            mode: LightweightCharts.CrosshairMode.Magnet,
            vertLine: {
              color: '${lineColor}',
              width: 1,
              style: LightweightCharts.LineStyle.Dashed,
              labelBackgroundColor: '${lineColor}',
            },
            horzLine: {
              color: '${lineColor}',
              width: 1,
              style: LightweightCharts.LineStyle.Dashed,
              labelBackgroundColor: '${lineColor}',
            },
          },
          rightPriceScale: {
            borderVisible: false,
            scaleMargins: chartType === 'candles'
              ? { top: 0.08, bottom: ${showVolume ? "0.25" : "0.08"} }
              : { top: 0.15, bottom: 0.1 },
            textColor: '#94A3B8',
          },
          timeScale: {
            borderVisible: false,
            textColor: '#94A3B8',
            timeVisible: true,
            secondsVisible: false,
            fixLeftEdge: true,
            fixRightEdge: true,
          },
          handleScale: true,
          handleScroll: true,
        });

        if (chartType === 'candles') {
          mainSeries = chart.addCandlestickSeries({
            upColor: '${upColor}',
            downColor: '${downColor}',
            borderVisible: false,
            wickUpColor: '${upColor}',
            wickDownColor: '${downColor}',
          });
          mainSeries.setData(candleData);

          ${showVolume ? `
          volumeSeries = chart.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
          });
          chart.priceScale('volume').applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
          });
          volumeSeries.setData(volumeData);
          ` : ``}

        } else {
          // Area series = line + gradient fill underneath
          mainSeries = chart.addAreaSeries({
            lineColor: '${lineColor}',
            lineWidth: 2,
            topColor: '${areaTopColor}',
            bottomColor: '${areaBotColor}',
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4,
            crosshairMarkerBorderColor: '${lineColor}',
            crosshairMarkerBackgroundColor: '${lineColor}',
            lastValueVisible: true,
            priceLineVisible: true,
            priceLineColor: '${lineColor}',
            priceLineWidth: 1,
            priceLineStyle: LightweightCharts.LineStyle.Dashed,
          });
          mainSeries.setData(lineData);
        }

        chart.timeScale().fitContent();

        // Live price update from React Native — updates the last bar/point
        window.updatePrice = function(price) {
          if (!price || !mainSeries) return;
          try {
            if (chartType === 'candles') {
              if (!candleData.length) return;
              var last = candleData[candleData.length - 1];
              var updated = {
                time: last.time,
                open: last.open,
                high: Math.max(last.high, price),
                low: Math.min(last.low, price),
                close: price,
              };
              candleData[candleData.length - 1] = updated;
              mainSeries.update(updated);
            } else {
              if (!lineData.length) return;
              var lastPt = lineData[lineData.length - 1];
              mainSeries.update({ time: lastPt.time, value: price });
            }
          } catch(e) {}
        };

        window.addEventListener('resize', function() {
          chart.applyOptions({
            width: window.innerWidth,
            height: window.innerHeight,
          });
        });

      } catch(err) {
        document.getElementById('msg').style.display = 'flex';
        document.getElementById('msg').innerText = 'Chart error: ' + err.message;
      }
    }
  </script>
</body>
</html>`;

  const injectedJS = livePrice
    ? `(function(){ if(window.updatePrice) window.updatePrice(${livePrice}); })(); true;`
    : null;

  // injectedJavaScript only fires once, on initial page load — it does NOT
  // re-run when the prop value changes on re-render. Live ticks arriving
  // after mount were silently being dropped, leaving the chart frozen on
  // a stale price. Push every live update imperatively via the ref instead.
  useEffect(() => {
    if (!webViewLoaded || livePrice == null) return;
    webViewRef.current?.injectJavaScript(
      `(function(){ if(window.updatePrice) window.updatePrice(${livePrice}); })(); true;`,
    );
  }, [livePrice, webViewLoaded]);

  // A fresh `html` string (new candles/chartType) reloads the WebView —
  // treat it as not-loaded until onLoadEnd fires again.
  useEffect(() => {
    setWebViewLoaded(false);
  }, [html]);

  if (loading) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <ActivityIndicator size="small" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ height, width: "100%" }}>
      <WebView
        ref={webViewRef}
        source={{ html }}
        style={{ flex: 1, backgroundColor: "transparent" }}
        mixedContentMode="always"
        originWhitelist={["*"]}
        scrollEnabled={false}
        bounces={false}
        javaScriptEnabled
        domStorageEnabled
        injectedJavaScript={injectedJS}
        onLoadEnd={() => setWebViewLoaded(true)}
        allowsInlineMediaPlayback
        onError={(e) => console.warn("ChartView error:", e.nativeEvent)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  placeholder: {
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  credit: {
    position: "absolute",
    bottom: 4,
    right: 8,
    fontSize: fontScale(9),
    color: Colors.borderLight,
  },
});

export default ChartView;