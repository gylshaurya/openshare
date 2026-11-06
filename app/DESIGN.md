# Bull Street design system

Based loosely on an institutional-exchange reference: quiet white canvas, one accent, calm display weights, tabular numbers, and pill controls. Bull Street has its own accent and type, so it never reads as a copy of the reference brand.

## World

A private-bank statement brought on-chain. Light, calm, exact. Dark bands appear only on the landing page, where they carry live product cards. Light is chosen for the use scene: people checking holdings and settling redemptions at a desk, often in daylight office hours that line up with NSE sessions.

## Color (tokens in `src/app/globals.css`)

| Token | Hex | Role |
|---|---|---|
| ink | #0b0d10 | Headings, primary text, dark bands |
| body | #545b66 | Running text |
| muted | #666d77 | Labels, secondary text (≥4.5:1 on white and soft) |
| hairline | #e4e6ea | 1px dividers and panel borders |
| canvas | #ffffff | Page floor |
| soft | #f5f6f7 | App background band, table headers, inactive segments |
| strong | #eceef1 | Secondary buttons, icon plates |
| dark / dark-2 | #0b0d10 / #16191d | Landing bands, floating product cards |
| accent (peacock) | #0f6b7d | Primary action, links, selection, focus (6.1:1 on white) |
| accent-hover | #0b5463 | Pressed and hover state |
| accent-soft | #e6f1f3 | Selected rows, active tabs |
| accent-on-dark | #5fcbd9 | Accent on dark bands |
| up / down | #0a7f4b / #c0262f | Price direction and health, as text color only |
| warn | #9a5b00 | Deadlines, closed market |

Strategy: Restrained in the app (neutrals, one accent, semantic states). The landing page commits to alternating dark and light bands.

## Type

- **Geist** for everything (UI and display); **Geist Mono** with tabular figures for every number, address and ISIN.
- Display: weight 400, tracking -0.03em, sizes 56/44/32. App headings: 24/600 page title, 15/600 panel title. Body 14px in the app, 16px on the landing page.
- Labels: 12px/500 in muted, sentence case. No eyebrows or kickers.

## Shape and depth

- Buttons, segmented controls and status pills: fully rounded.
- Panels 16px radius in the app; landing cards 24px. Inputs 12px.
- Flat surfaces with 1px hairline borders. A single soft shadow (`0 8px 24px rgba(11,13,16,.06)`) only on floating landing cards and menus.

## Signature: the backing meter

Every token is shown next to its backing: a thin bar of tokens outstanding against shares pledged plus reserve, with exact numbers. It appears in the landing hero card, every markets row, the trade header and the broker coverage column (bond vs exposure). A full bar is healthy; green means within the rule, red means broken.

## Components

PageHeader, Panel, Stat, StatusPill (dot + label), Button (primary / secondary / ghost / danger), Segmented, Field/Input, AssetMark (circular ticker plate), BackingMeter, DataTable (sticky muted header, tabular numbers, row hover), TxStatus (inline, with icon), Empty (explains what will appear and how).

## Motion

150–200ms ease-out on hover and focus. Pending transactions show an inline spinner. Pages have no entrance choreography.
