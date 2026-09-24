// ============================================================
// STRUCTURED ICON MAP
// ------------------------------------------------------------
// Exact key matching: task.symbol → structuredIconMap[task.symbol]
// Artwork is white SVG markup, centered at (0, 0), ready to insert
// into each portrait slot's icon group.
//
// Do NOT infer icons from task titles.
// Do NOT use emoji, raster images, Font Awesome, or external libraries.
// ============================================================

// DEVELOPMENT ONLY — temporary placeholder when artwork is missing.
// This is NOT a finished icon. Replace with real vector artwork
// in structuredIconMap for each Structured symbol identifier.
const DEVELOPMENT_FALLBACK_ICON = `<g data-development-fallback="true">
  <circle cx="0" cy="0" r="2.4" fill="#fff" opacity="0.55"/>
</g>`;

// Back-compat alias while migrating call sites
const FALLBACK_ICON = DEVELOPMENT_FALLBACK_ICON;

const structuredIconMap = {

  // --- Learning / school ---
  "book.fill": `<g transform="translate(-557,-264)">
<path class="cls-7" d="M553.41,261.13c1.2-.48,2.27-.36,3.23.36v5.38c-.96-.72-2.03-.84-3.23-.36v-5.38ZM557.36,261.49c.96-.72,2.03-.84,3.23-.36v5.38c-1.2-.48-2.27-.36-3.23.36v-5.38Z"/>
</g>`,
  "book.closed.fill": `<g transform="translate(-524,-293)">
<path class="cls-7" d="M521.49,289.41h5.74v6.45h-5.74c-.72,0-1.08-.36-1.08-1.08v-4.3c0-.72.36-1.08,1.08-1.08Z"/>
        <path class="cls-4" d="M521.85,290.49v4.3h4.66"/>
</g>`,
  "graduationcap.fill": `<g transform="translate(-541,-264)">
<path class="cls-7" d="M537.06,262.57l3.94-1.79,3.94,1.79-3.94,1.79-3.94-1.79ZM538.49,264l2.51,1.08,2.51-1.08v1.79c-1.67,1.2-3.35,1.2-5.02,0v-1.79Z"/>
        <path class="cls-5" d="M537.77,263.28v2.87"/>
</g>`,
  "pencil.and.outline": `<g transform="translate(-574,-264)">
<path class="cls-7" d="M571.13,265.08l4.3-4.3,1.79,1.79-4.3,4.3-2.15.36.36-2.15Z"/>
        <path class="cls-5" d="M574.36,267.23h3.23"/>
</g>`,
  "highlighter": `<g transform="translate(-657,-293)">
<path class="cls-7" d="M654.13,294.08l3.94-4.3,2.15,2.15-3.94,3.94-2.15-1.79ZM653.77,295.15l1.08,1.08-1.79.72.72-1.79Z"/>
</g>`,
  "x.squareroot": `<g transform="translate(-765,-336)">
<path class="cls-5" d="M761.41,337.08l1.08,1.43,1.43-5.02h4.66M765.36,335.28l2.51,2.87M767.87,335.28l-2.51,2.87"/>
</g>`,
  "text.badge.checkmark": `<g transform="translate(-632,-278)">
<path class="cls-5" d="M628.77,275.49h6.1M628.77,277.28h3.94M628.77,279.08h2.15M632,280.15l1.08,1.08,2.51-2.87"/>
</g>`,

  // --- Creative / media ---
  "paintbrush.pointed.fill": `<g transform="translate(-541,-293)">
<path class="cls-7" d="M539.92,293.72l3.23-4.3c.72-.48,1.08-.24,1.08.72l-2.51,4.66-1.79-1.08ZM539.57,294.08c1.43,0,1.91.6,1.43,1.79-.72.72-1.79.84-3.23.36.96-.24,1.31-.6,1.08-1.08l.72-1.08Z"/>
</g>`,
  "camera.fill": `<g transform="translate(-715,-336)">
<path class="cls-7" d="M711.41,334.21h1.79l.72-1.43h2.51l.72,1.43h1.43v5.02h-7.17v-5.02Z"/>
        <circle class="cls-1" cx="715" cy="336.72" r="1.43"/>
</g>`,
  "video.fill": `<g transform="translate(-516,-307)">
<path class="cls-7" d="M512.06,304.49h5.38v5.38h-5.38v-5.38ZM518.15,306.28l2.15-1.43v5.02l-2.15-1.43v-2.15Z"/>
</g>`,
  "keyboard": `<g transform="translate(-641,-379)">
<path class="cls-5" d="M637.06,376.49h7.89v5.02h-7.89v-5.02ZM638.49,377.92h.36M640.28,377.92h.36M642.08,377.92h.36M643.87,377.92h.36M638.49,379.36h.36M640.28,379.36h.36M642.08,379.36h.36M638.85,380.43h4.3"/>
</g>`,

  // --- Work / productivity ---
  "desktopcomputer": `<g transform="translate(-649,-278)">
<path class="cls-5" d="M645.41,274.77h7.17v5.02h-7.17v-5.02ZM649,279.79v1.43M647.21,281.59h3.59"/>
</g>`,
  "briefcase.fill": `<g transform="translate(-724,-379)">
<path class="cls-7" d="M720.41,377.57h7.17v4.3h-7.17v-4.3Z"/>
        <path class="cls-5" d="M722.57,377.57v-1.43h2.87v1.43"/>
        <path class="cls-2" d="M720.41,379c2.39,1.43,4.78,1.43,7.17,0"/>
</g>`,
  "chevron.left.slash.chevron.right": `<g transform="translate(-690,-322)">
<path class="cls-5" d="M688.21,319.49l-2.15,2.51,2.15,2.51M691.79,319.49l2.15,2.51-2.15,2.51M690.72,318.41l-1.43,7.17"/>
</g>`,
  "calendar": `<g transform="translate(-732,-538)">
<path class="cls-5" d="M728.41,535.49h7.17v6.1h-7.17v-6.1ZM728.41,537.28h7.17M730.21,534.41v1.79M733.79,534.41v1.79M729.85,538.72h1.08M732.72,538.72h1.43M729.85,540.15h1.08"/>
</g>`,

  // --- Personal / errands ---
  "bag.fill": `<g transform="translate(-599,-278)">
<path class="cls-7" d="M596.13,276.57h5.74v4.66h-5.74v-4.66Z"/>
        <path class="cls-5" d="M597.57,276.57v-.72c0-.79.64-1.43,1.43-1.43s1.43.64,1.43,1.43v.72"/>
</g>`,
  "cart.fill": `<g transform="translate(-774,-350)">
<path class="cls-5" d="M770.06,346.77h1.08l1.08,4.66h4.66l1.08-3.23h-6.45"/>
        <circle class="cls-7" cx="772.92" cy="353.23" r=".72"/>
        <circle class="cls-7" cx="776.51" cy="353.23" r=".72"/>
</g>`,
  "shippingbox.fill": `<g transform="translate(-524,-264)">
<path class="cls-7" d="M520.41,262.21l3.23,1.79v3.94l-3.23-1.79v-3.94ZM524.36,264l3.23-1.79v3.94l-3.23,1.79v-3.94ZM520.77,261.49l3.23-1.43,3.23,1.43-3.23,1.79-3.23-1.79Z"/>
</g>`,
  "house.fill": `<g transform="translate(-566,-278)">
<path class="cls-7" d="M562.06,277.64l3.94-3.59,3.94,3.59h-1.08v4.3h-2.15v-2.87h-1.43v2.87h-2.15v-4.3h-1.08Z"/>
</g>`,
  "gift.fill": `<g transform="translate(-499,-336)">
<path class="cls-7" d="M495.41,335.64h2.87v3.94h-2.51v-3.23h-.36v-.72ZM499.72,335.64h2.87v.72h-.36v3.23h-2.51v-3.94Z"/>
        <path class="cls-5" d="M499,339.59v-5.38M495.41,334.57h7.17M499,334.21c-2.87.24-3.71-.36-2.51-1.79.96-.48,1.79.12,2.51,1.79.96-1.67,1.91-2.15,2.87-1.43.48,1.2-.48,1.67-2.87,1.43"/>
</g>`,
  "fork.knife": `<g transform="translate(-591,-408)">
<path class="cls-5" d="M587.77,404.41v2.51c.72.96,1.43.96,2.15,0v-2.51M588.85,404.41v7.17M592.43,404.41v3.94h1.79v-3.94M594.23,408.36v3.23"/>
</g>`,
  "custom.toothbrush": `<g transform="translate(-449,-422)">
<path class="cls-5" d="M445.77,425.23l3.94-3.94,1.43-.36,1.43-1.43M450.08,420.57l-1.08-1.08M451.15,420.21l-1.08-1.43M452.23,419.49l-1.08-1.43"/>
</g>`,

  // --- People / communication ---
  "person.3.fill": `<g transform="translate(-499,-278)">
<circle class="cls-7" cx="499" cy="275.85" r="1.08"/>
        <circle class="cls-7" cx="496.13" cy="276.57" r=".9"/>
        <circle class="cls-7" cx="501.87" cy="276.57" r=".9"/>
        <path class="cls-7" d="M497.21,281.23v-2.15c1.2-1.67,2.39-1.67,3.59,0v2.15h-3.59ZM494.7,280.87v-1.79c.48-.96,1.08-1.2,1.79-.72v2.51h-1.79ZM501.51,280.87v-2.51c.72-.48,1.31-.24,1.79.72v1.79h-1.79Z"/>
</g>`,
  "bubble.left.fill": `<g transform="translate(-666,-278)">
<path class="cls-7" d="M662.77,274.77h6.45c.48,0,.72.36.72,1.08v3.59c0,.72-.36,1.08-1.08,1.08h-3.94l-2.15,1.43v-1.43c-.48,0-.72-.36-.72-1.08v-3.59c0-.72.24-1.08.72-1.08Z"/>
</g>`,
  "envelope.fill": `<g transform="translate(-649,-336)">
<path class="cls-7" d="M645.41,333.13h7.17l-3.59,2.87-3.59-2.87ZM645.41,334.21l3.59,2.87,3.59-2.87v4.66h-7.17v-4.66Z"/>
</g>`,
  "phone.fill": `<g transform="translate(-516,-365)">
<path class="cls-7" d="M512.77,361.41l1.79-.36,1.08,2.15-1.08,1.08c.48,1.2,1.31,2.03,2.51,2.51l1.08-1.08,1.79,1.08-.36,1.79c-3.35.96-5.86-.72-7.53-5.02l.72-2.15Z"/>
</g>`,
  "heart.fill": `<g transform="translate(-532,-307)">
<path class="cls-7" d="M532,310.59l-3.59-3.59c-2.51-3.59,1.79-5.38,3.59-2.51,1.79-2.87,6.1-1.08,3.59,2.51l-3.59,3.59Z"/>
</g>`,

  // --- Events / lifestyle ---
  "birthday.cake.fill": `<g transform="translate(-549,-307)">
<path class="cls-7" d="M545.77,307h6.45v3.23h-6.45v-3.23ZM546.85,305.21h4.3v1.08h-4.3v-1.08Z"/>
        <path class="cls-5" d="M549,305.21v-1.43M545.41,310.59h7.17"/>
</g>`,
  "dumbbell.fill": `<g transform="translate(-574,-322)">
<path class="cls-7" d="M570.06,320.57h1.08v-1.43h1.43v2.15h2.87v-2.15h1.43v1.43h1.08v2.87h-1.08v1.43h-1.43v-2.15h-2.87v2.15h-1.43v-1.43h-1.08v-2.87Z"/>
</g>`,
  "alarm.fill": `<g transform="translate(-532,-365)">
<path class="cls-7" d="M528.77,362.85c-.48-.96-.24-1.43.72-1.43.72,0,1.08.12,1.08.36l-1.79,1.08ZM533.43,361.77c.96-.72,1.67-.6,2.15.36l-.36.72-1.79-1.08Z"/>
        <circle class="cls-7" cx="532" cy="365.36" r="2.87"/>
        <path class="cls-3" d="M532,363.21v2.15h-1.43"/>
        <path class="cls-5" d="M529.85,367.87l-.72.72M534.15,367.87l.72.72"/>
</g>`,
  "airplane": `<g transform="translate(-882,-480)">
<path class="cls-7" d="M881.28,476.41c.48-.72.96-.72,1.43,0v2.51l3.23,2.15v1.08l-3.23-1.43v2.15l1.43.72v.72l-2.15-.72-2.15.72v-.72l1.43-.72v-2.15l-3.23,1.43v-1.08l3.23-2.15v-2.51Z"/>
</g>`,
  "moon.fill": `<g transform="translate(-782,-768)">
<path class="cls-7" d="M784.15,771.23c-1.88.99-4.21.27-5.2-1.61-.99-1.88-.27-4.21,1.61-5.2-1.39,1.39-1.39,3.63,0,5.02s3.63,1.39,5.02,0c-.24.72-.72,1.31-1.43,1.79Z"/>
</g>`,

  // --- Batch: top 20 previously missing (centered at 0,0) ---
  // White pictograms matching portrait icon weight; exact Structured keys only.

  "dollarsign.circle.fill": `<g>
    <circle class="cls-5" cx="0" cy="0" r="3.4"/>
    <path class="cls-5" d="M0,-2.2v4.4M-1.1,-1.2c0-.9.7-1.4,1.6-1.4s1.5.4,1.5,1.2c0,.7-.5,1-1.5,1.2l-1.1.3c-1.1.3-1.7.8-1.7,1.7,0,1,.9,1.5,1.9,1.5s1.7-.5,1.8-1.3"/>
  </g>`,

  "person.2.fill": `<g>
    <circle class="cls-7" cx="-1.7" cy="-1.8" r="1.05"/>
    <path class="cls-7" d="M-3.4,2.9v-1.9c1.1-1.5,2.2-1.5,3.4,0v1.9z"/>
    <circle class="cls-7" cx="1.7" cy="-1.5" r=".95"/>
    <path class="cls-7" d="M.2,2.9v-1.7c.9-1.3,1.9-1.3,3,0v1.7z"/>
  </g>`,

  "car.fill": `<g>
    <path class="cls-7" d="M-3.6.2l.7-1.8c.2-.5.6-.8,1.1-.8h3.6c.5,0,.9.3,1.1.8l.7,1.8h.4c.4,0,.7.3.7.7v1.3c0,.3-.2.5-.5.5h-.5v.2c0,.6-.5,1.1-1.1,1.1s-1.1-.5-1.1-1.1v-.2h-2.8v.2c0,.6-.5,1.1-1.1,1.1s-1.1-.5-1.1-1.1v-.2h-.5c-.3,0-.5-.2-.5-.5v-1.3c0-.4.3-.7.7-.7z"/>
    <circle class="cls-1" cx="-2" cy="2.1" r=".55"/>
    <circle class="cls-1" cx="2" cy="2.1" r=".55"/>
  </g>`,

  "stethoscope": `<g>
    <path class="cls-5" d="M-2.4,-2.6v1.8c0,1.5,1.1,2.6,2.4,2.6s2.4-1.1,2.4-2.6v-1.8"/>
    <circle class="cls-5" cx="-2.4" cy="-2.8" r=".55"/>
    <circle class="cls-5" cx="2.4" cy="-2.8" r=".55"/>
    <path class="cls-5" d="M0,1.8c0,1.2.9,2.1,2,2.1"/>
    <circle class="cls-7" cx="2.6" cy="3.1" r=".85"/>
  </g>`,

  "puzzlepiece.fill": `<g>
    <path class="cls-7" d="M-2.8,-1.2v-1.4c0-.4.3-.7.7-.7h1.2c0-.9.7-1.5,1.4-1.5s1.4.6,1.4,1.5h1.2c.4,0,.7.3.7.7v1.2c.9,0,1.5.7,1.5,1.4s-.6,1.4-1.5,1.4v1.2c0,.4-.3.7-.7.7h-1.2c0,.9-.7,1.5-1.4,1.5s-1.4-.6-1.4-1.5h-1.2c-.4,0-.7-.3-.7-.7v-1.2c-.9,0-1.5-.7-1.5-1.4s.6-1.4,1.5-1.4z"/>
  </g>`,

  "custom.hairdryer": `<g>
    <path class="cls-7" d="M-1.2,-2.2h3.2c1.1,0,1.9.9,1.9,1.9v.4c0,1.1-.9,1.9-1.9,1.9h-1.4l-.6,2.4h-1.3l.5-2.4h-.4c-.9,0-1.6-.7-1.6-1.6v-.6c0-1.1.7-2,1.6-2z"/>
    <path class="cls-7" d="M-3.6,-.6h2.2v1.2h-2.2z"/>
    <circle class="cls-1" cx="1.5" cy="-.2" r=".7"/>
  </g>`,

  "custom.lipstick": `<g>
    <path class="cls-7" d="M-.9,-3.4c0-.4.4-.8.9-1,.5.2.9.6.9,1v1.2h-1.8z"/>
    <rect class="cls-7" x="-1.2" y="-2.1" width="2.4" height="1.1" rx=".2"/>
    <rect class="cls-7" x="-1.5" y="-1" width="3" height="4.2" rx=".35"/>
  </g>`,

  "dishwasher.fill": `<g>
    <rect class="cls-7" x="-3" y="-3.1" width="6" height="6.2" rx=".4"/>
    <path class="cls-1" d="M-2.3,-1.5h4.6v3.6h-4.6z"/>
    <circle class="cls-1" cx="1.7" cy="-2.3" r=".35"/>
    <path stroke="gray" stroke-width=".45" fill="none" d="M-2.1,-2.3h2.2"/>
  </g>`,

  "newspaper.fill": `<g>
    <path class="cls-7" d="M-3.4,-2.8h6.8v5.6h-6.8z"/>
    <path class="cls-1" d="M-2.6,-2h2v1.5h-2z"/>
    <path stroke="gray" stroke-width=".4" fill="none" stroke-linecap="round" d="M-.1,-2h2.4M-.1,-1.2h2.4M-2.6,.2h5.2M-2.6,1.1h5.2M-2.6,2h3.4"/>
  </g>`,

  "pencil.and.ruler.fill": `<g>
    <path class="cls-7" d="M-2.6,-3.1h5.4v1.5h-5.4z"/>
    <path stroke="gray" stroke-width=".35" fill="none" d="M-1.8,-3.1v1.5M-.6,-3.1v1.5M.6,-3.1v1.5M1.8,-3.1v1.5"/>
    <path class="cls-7" d="M-3.2,2.4l4.8-4.8,1.3,1.3-4.8,4.8-1.6.4z"/>
    <path class="cls-5" d="M1.8,-2.8l1.4,1.4"/>
  </g>`,

  "film.fill": `<g>
    <rect class="cls-7" x="-3.3" y="-2.6" width="6.6" height="5.2" rx=".3"/>
    <path class="cls-1" d="M-2.5,-1.7h1.3v1.2h-1.3zM-.6,-1.7h1.3v1.2h-1.3zM1.2,-1.7h1.3v1.2h-1.3zM-2.5,.4h1.3v1.2h-1.3zM-.6,.4h1.3v1.2h-1.3zM1.2,.4h1.3v1.2h-1.3z"/>
    <path stroke="gray" stroke-width=".45" fill="none" d="M-3.05,-2.1v.4M-3.05,-.7v.4M-3.05,.7v.4M-3.05,1.9v.4M3.05,-2.1v.4M3.05,-.7v.4M3.05,.7v.4M3.05,1.9v.4"/>
  </g>`,

  "custom.broom": `<g>
    <path class="cls-5" d="M1.4,-3.4l-2.2,4.4"/>
    <path class="cls-7" d="M-2.8,1.2l3.8-.4.6,1.1-4.6,1.8z"/>
    <path class="cls-5" d="M-2.4,1.6l-.6,2.2M-1.4,1.5l-.2,2.4M-.4,1.4l.3,2.4M.6,1.3l.7,2.2"/>
  </g>`,

  "hammer.fill": `<g>
    <path class="cls-7" d="M-2.8,-2.6h4.2c.5,0,.8.4.8.9v1.3c0,.4-.3.7-.7.7h-1.1v.4l-2.4,4.1h-1.3l2.3-4.1v-.4h-1.8c-.5,0-.8-.4-.8-.9v-1.3c0-.5.4-.9.8-.9z"/>
  </g>`,

  "custom.mop": `<g>
    <path class="cls-5" d="M0,-3.5v4.2"/>
    <path class="cls-7" d="M-2.4,.8h4.8v.7c0,1.4-1.1,2.5-2.4,2.5s-2.4-1.1-2.4-2.5z"/>
    <path class="cls-5" d="M-1.8,1.7v2.2M0,1.7v2.4M1.8,1.7v2.2"/>
  </g>`,

  "person.fill": `<g>
    <circle class="cls-7" cx="0" cy="-2" r="1.25"/>
    <path class="cls-7" d="M-2.2,3.1v-2.2c1.4-1.9,3-1.9,4.4,0v2.2z"/>
  </g>`,

  "tv.fill": `<g>
    <rect class="cls-7" x="-3.2" y="-2.6" width="6.4" height="4.4" rx=".35"/>
    <path class="cls-1" d="M-2.5,-1.9h5v3h-5z"/>
    <path class="cls-7" d="M-1.2,2.1h2.4v.9h-2.4z"/>
    <path stroke="gray" stroke-width=".5" fill="none" stroke-linecap="round" d="M-1.8,3h3.6"/>
  </g>`,

  "wand.and.stars": `<g>
    <path class="cls-7" d="M-2.8,2.9l4.6-4.6,1.1,1.1-4.6,4.6z"/>
    <path class="cls-7" d="M1.4,-3.1l.35,.9.95,.1-.7.65.25.95-.85-.5-.85.5.25-.95-.7-.65.95-.1z"/>
    <path class="cls-7" d="M3,-.4l.25.65.7.08-.52.48.18.7-.61-.37-.61.37.18-.7-.52-.48.7-.08z"/>
  </g>`,

  "headphones": `<g>
    <path class="cls-5" d="M-2.8,0v-1c0-1.7,1.3-3,2.8-3s2.8,1.3,2.8,3v1"/>
    <path class="cls-7" d="M-3.5,-.2h1.4v3.1c0,.5-.4.9-.9.9h-.5c-.5,0-.9-.4-.9-.9z"/>
    <path class="cls-7" d="M2.1,-.2h1.4v3.1c0,.5-.4.9-.9.9h-.5c-.5,0-.9-.4-.9-.9z"/>
  </g>`,

  "studentdesk": `<g>
    <path class="cls-7" d="M-3.4,-.4h6.8v.7h-6.8z"/>
    <path class="cls-5" d="M-2.6,.3v3M2.6,.3v3M-1.2,.3v1.5h2.4"/>
    <path class="cls-7" d="M-1.5,-2.6h1.4c.9,0,1.5.5,1.5,1.4v.5h-2.9v-.5c0-.5.2-.9.6-1.1z"/>
  </g>`,

  "atom": `<g>
    <circle class="cls-7" cx="0" cy="0" r=".7"/>
    <ellipse class="cls-5" cx="0" cy="0" rx="3.3" ry="1.3" transform="rotate(60)"/>
    <ellipse class="cls-5" cx="0" cy="0" rx="3.3" ry="1.3" transform="rotate(-60)"/>
    <ellipse class="cls-5" cx="0" cy="0" rx="3.3" ry="1.3"/>
  </g>`,
};
