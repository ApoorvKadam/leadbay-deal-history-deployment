import { getDomain } from "tldts";

const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

export function canonicalizeWebsite(raw: string | null | undefined): string | null {
  const value = raw?.normalize("NFKC").trim();
  if (!value) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (hasScheme && !/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(hasScheme ? value : `https://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return getDomain(url.hostname.toLocaleLowerCase("en-US").replace(/\.$/, ""), {
      allowPrivateDomains: true,
    });
  } catch {
    return null;
  }
}

export interface BusinessDomainResult {
  domain: string | null;
  rejectedConsumer: boolean;
}

export function deriveBusinessDomain(raw: string | null | undefined): BusinessDomainResult {
  const value = raw?.normalize("NFKC").trim();
  if (!value) return { domain: null, rejectedConsumer: false };
  const firstAt = value.indexOf("@");
  if (firstAt <= 0 || firstAt !== value.lastIndexOf("@") || firstAt === value.length - 1) {
    return { domain: null, rejectedConsumer: false };
  }
  const domain = canonicalizeWebsite(value.slice(firstAt + 1));
  if (!domain) return { domain: null, rejectedConsumer: false };
  if (CONSUMER_DOMAINS.has(domain)) return { domain: null, rejectedConsumer: true };
  return { domain, rejectedConsumer: false };
}
