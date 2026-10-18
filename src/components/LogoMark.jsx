import { NAME } from "../brand";

// An eye (vision) cut by one horizontal line (a section): ink square, ivory
// strokes, accent iris. Same drawing as public/favicon.svg.
export default function LogoMark() {
  return (
    <svg className="logo-mark" width="28" height="28" viewBox="0 0 32 32" role="img" aria-label={NAME}>
      <rect width="32" height="32" rx="7" fill="#2a2622" />
      <path d="M3.5 16C8 9.2 12 7.6 16 7.6S24 9.2 28.5 16C24 22.8 20 24.4 16 24.4S8 22.8 3.5 16Z" fill="none" stroke="#fbfaf6" stroke-width="2" stroke-linejoin="round"/>
      <path d="M1.5 16H30.5" stroke="#fbfaf6" stroke-width="1.6"/>
      <circle cx="16" cy="16" r="4.6" fill="#96662c"/>
    </svg>
  );
}
