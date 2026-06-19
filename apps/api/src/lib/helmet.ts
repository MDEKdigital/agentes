import type { FastifyHelmetOptions } from "@fastify/helmet";

// CSP conservadora para uma API REST JSON:
// - default-src 'self': bloqueia tudo por padrão
// - img-src: permite data: URIs e HTTPS externo (para páginas de erro)
// - style-src 'unsafe-inline': necessário para páginas de erro do Fastify
// - script-src 'self': sem scripts externos
// - connect-src 'self' https:: permite que a página de health faça fetch HTTPS
// - frame-ancestors 'none': anti-clickjacking (equivale a X-Frame-Options: DENY)
//
// Cross-Origin-Resource-Policy: cross-origin porque o frontend (origem diferente)
// precisa ler as respostas JSON da API — 'same-origin' bloquearia isso.

export const helmetOptions: FastifyHelmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "https:"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  // HSTS: 180 dias, inclui subdomínios. Ignorado por browsers em HTTP (dev local).
  hsts: {
    maxAge: 15_552_000,
    includeSubDomains: true,
  },
};
