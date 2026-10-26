/**
 * Environment switches shared by the telemetry init hook and telemetry.ts.
 *
 * Deliberately free of OpenTelemetry SDK imports: the init hook needs to test
 * the disable switch before telemetry.js is loaded, and statically importing
 * telemetry.js there would drag the whole OTel SDK (~130 modules) into every
 * invocation's startup — including the runs that turn telemetry off.
 */

export function isEnvTrue(value: string | undefined): boolean {
  return value !== undefined && ['1', 'on', 'true', 'yes'].includes(value.trim().toLowerCase())
}

export function isTelemetryEnvDisabled(): boolean {
  // `SDKCK_OTEL_DISABLED` turns telemetry off for sdkck specifically, without
  // affecting the standard `OTEL_SDK_DISABLED` that other OpenTelemetry-enabled
  // tools on the host may rely on.
  return isEnvTrue(process.env.SDKCK_OTEL_DISABLED) || isEnvTrue(process.env.OTEL_SDK_DISABLED)
}
