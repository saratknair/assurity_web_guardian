import type { Page } from "@playwright/test";

export interface Heading { level: number; text: string }
export interface LinkInfo { href: string; text: string; external: boolean }
export interface ImageInfo { src: string; alt: string }
export interface FormField { name: string; type: string } // NOTE: never a `value` (no PII)
export interface FormInfo { name: string; fields: FormField[]; buttons: string[] }

export interface PageInventory {
  url: string;
  title: string;
  headings: Heading[];
  links: LinkInfo[];
  images: ImageInfo[];
  buttons: string[];
  forms: FormInfo[];
}

export interface InventoryHandoff {
  correlationId: string;
  taskId: string;
  partial: boolean;
  failedViewport: string | null;
  pages: PageInventory[];
}

/**
 * Inventory_Agent (Req 2, 31.3). Deterministic extraction of objective page
 * elements. Never submits a form; never records a field VALUE (no PII, Req 2.5).
 * Runs inside the browser via page.evaluate.
 */
export async function extractInventory(
  page: Page,
  url: string,
  approvedDomain: string,
): Promise<PageInventory> {
  const title = (await page.title()).trim();
  return page.evaluate(
    ({ url, approvedDomain, title }) => {
      const isExternal = (href: string): boolean => {
        try {
          const h = new URL(href, location.href).hostname.toLowerCase();
          return !(h === approvedDomain || h.endsWith("." + approvedDomain));
        } catch {
          return false;
        }
      };
      const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((el) => ({
        level: Number(el.tagName.substring(1)),
        text: (el.textContent ?? "").trim().slice(0, 300),
      }));
      const links = Array.from(document.querySelectorAll("a[href]")).map((a) => {
        const href = (a as HTMLAnchorElement).href;
        return { href, text: (a.textContent ?? "").trim().slice(0, 200), external: isExternal(href) };
      });
      const images = Array.from(document.querySelectorAll("img")).map((img) => ({
        src: (img as HTMLImageElement).src,
        alt: (img as HTMLImageElement).alt ?? "",
      }));
      const looksLikeCss = (t: string): boolean =>
        /[{};]/.test(t) || /\.gsbp|@media|var\(--|px;|fill:/.test(t);
      const buttons = Array.from(document.querySelectorAll("button,[role=button]"))
        .map((b) => {
          // Prefer accessible name over raw textContent (avoids embedded <style>).
          const aria = b.getAttribute("aria-label");
          const text = (aria ?? b.textContent ?? "").replace(/\s+/g, " ").trim();
          return text;
        })
        .filter((t) => t.length > 0 && t.length <= 80 && !looksLikeCss(t))
        .slice(0, 100);
      const forms = Array.from(document.querySelectorAll("form")).map((f) => ({
        name: f.getAttribute("name") ?? f.getAttribute("id") ?? "form",
        // Record field name + type ONLY. Never the value (Req 2.5, 11.3).
        fields: Array.from(f.querySelectorAll("input,select,textarea")).map((el) => ({
          name: el.getAttribute("name") ?? el.getAttribute("id") ?? "",
          type: el.getAttribute("type") ?? el.tagName.toLowerCase(),
        })),
        buttons: Array.from(f.querySelectorAll("button,[type=submit]"))
          .map((b) => (b.textContent ?? "").trim())
          .filter((t) => t.length > 0),
      }));
      return { url, title, headings, links, images, buttons, forms };
    },
    { url, approvedDomain, title },
  );
}

