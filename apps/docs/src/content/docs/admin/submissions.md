---
title: Submissions
description: Viewing and managing challenge submissions in rCTF.
order: 4
---

rCTF keeps accepted solves and a broader submission log. The admin panel can remove solves and inspect the IP history for flag attempts and admin bot jobs.

## Viewing solves

The solve list shows the team, timestamp, and placement for each accepted flag.

## Deleting solves

Admins with `challsSolveWrite` can remove a solve caused by cheating, a leaked flag, or an administrative mistake.

:::warning
Deleting a solve triggers an automatic leaderboard recalculation, and the team's score and rank update to match.
:::

## Submission tracking

Each solve records the submitter's IP address. The submissions table also records flag attempts and admin bot submissions, with filters for time, challenge, team, IP, submission type, and result. Use it to investigate activity such as several teams submitting the same flag from the same address.

Shared IP addresses have a yellow badge marked “shared”. Expand the submission row to see “Shared IP with” and links to the other teams' admin profiles. Matches include all recorded flag attempts and admin bot submissions, even those outside the current filters or page. Sharing an address is informational and can happen when teams use the same university network; it does not mark a submission as cheating.

Set `sharedIpWarning: false` in your YAML configuration to skip shared-IP detection and hide sharing warnings and team details. It defaults to `true`; IP recording and rate limits are unaffected.

## First bloods

The first three solves, ordered by timestamp, are first, second, and third blood. A configured [blood bot](/integrations/bloodbot) announces them automatically.
