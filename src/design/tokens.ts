// Visual contract adapted from fortuna-gold-main for the existing React Router app.
// Values mirror the semantic CSS variables in styles.css so later native surfaces
// can reuse the same brand palette without coupling to the web components.
export const designTokens = {
  colors: {
    background: 'oklch(.12 .015 165)',
    surface: 'oklch(.165 .02 165)',
    surfaceRaised: 'oklch(.2 .022 165)',
    foreground: 'oklch(.95 .012 85)',
    muted: 'oklch(.7 .02 90)',
    emerald: 'oklch(.38 .09 160)',
    emeraldDeep: 'oklch(.27 .07 163)',
    emeraldBright: 'oklch(.74 .17 155)',
    gold: 'oklch(.76 .12 85)',
    goldLight: 'oklch(.92 .08 90)',
    goldDeep: 'oklch(.55 .1 75)',
    border: 'oklch(.76 .12 85 / .28)',
    success: 'oklch(.74 .17 155)',
    warning: 'oklch(.83 .13 80)',
    danger: 'oklch(.75 .12 20)',
  },
  fonts: { display: 'Cormorant Garamond', body: 'Karla' },
  radius: { card: '.875rem', button: '.75rem' },
  touchTarget: '3rem',
} as const;
