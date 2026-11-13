import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { logger } from "../../shared/utils/logger.js";

// why: dev-only console exporter for now — swap traceExporter for an OTLP exporter
// (Jaeger/Tempo/Honeycomb) later without touching instrumentation setup below
const sdk = new NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "ec-backend" }),
  traceExporter: new ConsoleSpanExporter(),
  instrumentations: [
    getNodeAutoInstrumentations({
      // why: fs/net/dns/tls fire a span per socket handshake and file read (e.g. every Mongo Atlas
      // heartbeat) — pure plumbing noise that buries the http/express/pg/mongodb/redis spans that
      // actually map to a request
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-net": { enabled: false },
      "@opentelemetry/instrumentation-dns": { enabled: false },
    }),
  ],
});

sdk.start();
logger.info("OpenTelemetry tracing started (console exporter)");

process.on("SIGTERM", () => sdk.shutdown().catch(() => {}));
process.on("SIGINT", () => sdk.shutdown().catch(() => {}));
