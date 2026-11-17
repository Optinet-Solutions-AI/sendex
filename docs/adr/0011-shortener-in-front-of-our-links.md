# ADR 0011: A shortener in front of our own short links, on a different domain per lap

Date: 2026-11-17. Status: accepted for test sends; to be revisited before real volume.

## Context

The link in an SMS is `${LINKS_BASE_URL}/<shortCode>`. In production `LINKS_BASE_URL` is still the links service's default `workers.dev` address, about 50 characters, because no short domain is attached to it yet. On the first live test (16 November 2026) the recipient saw that long address, and the team asked for what SMS Edge shows: a short address, and a different one on every lap. Emily's examples from one SMS Edge campaign were three unrelated domains with two or three characters after the slash, and "every lap we have gives a different shortener".

A Short.io account was opened for this (Free plan) with three set-up domains. Measured on 17 November 2026 with that account: a link is made in about a second, a bulk call takes up to 1000 links, and the plan allows 1000 links in total for the life of the account.

Sendex makes one short code per SMS: that is how a click, and later a registration or a deposit, is tied to the person who got the message. That cannot be given up for a shorter address.

## Decision

- **The shortener sits in front of our link, it does not replace it.** For each SMS the worker still makes its own short code and stores it on the message. It then asks the shortener for an address that forwards to `${LINKS_BASE_URL}/<shortCode>` and puts that address in the text. A click goes shortener, then our links service, then the offer; the links service counts the click and fills the offer's placeholders as before.
- **One domain per lap, the next lap takes the next domain.** `shortDomainForLap` in `packages/core` puts the shortener's set-up domains in alphabetical order and picks by the lap's place among the campaign's laps, starting over when there are more laps than domains. The domains are read from the shortener (cached five minutes), so a domain added in its dashboard joins the rotation without a deploy.
- **Links are made ahead of the batch, outside the transaction.** The send loop asks for the batch's addresses in one bulk call before it claims the members, and for no more than there are numbers left, so none is wasted at the end of a list.
- **The shortener can never stop a send.** Without `SHORT_IO_KEY` nothing changes. If the domains cannot be read, the lap sends our own links. If a bulk call is refused (for example the plan's links are used up), that batch and the rest of the lap send our own links. If one address is missing from an answer, that one message carries our own link.
- **Balance and cap estimates still count our own, longer link.** The text is billed by the parts of what is really sent, so a shortened message can cost fewer parts than the estimate, never more.

- **Added 2026-11-17 (D4-24): the ending is ours, three characters.** The team asked for an address as short as SMS Edge's (two or three characters after the slash; Short.io's own endings are six). The worker asks for a random three-character ending per link, about 175,000 per domain, which is ample for a plan of 1,000 links. An ending already taken is asked for again without one, so Short.io picks. Three characters will not hold real volume; the length has to grow when our own short domains replace this.

## Consequences

- With the Free plan this is for test sends only: one link per SMS means the account's 1000 links are 1000 SMS. After that every lap falls back to our own link by itself; nothing fails.
- A click now passes through a third party, which adds a redirect and makes the shortener's uptime, its rules on what may be linked and how carriers treat its shared `s.gy` addresses part of delivery. None of those was verified here.
- The same code would take any other shortener behind the `LinkShortener` interface.
- The lasting answer for volume is unchanged: our own short domains attached to the links service, with the same per-lap rotation done there. `shortDomainForLap` is written so that step can reuse it.
