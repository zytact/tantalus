import { encode } from "uqr";

const modulePixels = 5;

/** A scannable code for `value`, drawn dark on light in both themes so every camera can read it. */
export function QrCode({ value }: { value: string }) {
  const { data, size } = encode(value, { border: 4 });
  const modules = data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : [])));
  return (
    <svg
      className="qr-code"
      width={size * modulePixels}
      height={size * modulePixels}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`QR code for ${value}`}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={modules.join("")} fill="#000" />
    </svg>
  );
}
