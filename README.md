# Red Bull FASTER 2026 — Leaderboard

**Leaderboard for the Red Bull FASTER 2026 tournament.**

Displays current time of players across all Stage 1 maps (Obstacle, Everest, Skate) and Stage 2 maps (Railways, Soapbox, Roadtrip) + when they last improved one of their times.  
You can search for players, toggle which stage's maps are visible, and sort the leaderboard by a single map by clicking on its column header.  
Times are updated every minute.

![Screenshot](screenshot.png)

## How it works

A **Cloudflare Worker** cron job runs every 60 seconds, fetching leaderboard data from Nadeo's Live Services API for all six maps. It aggregates player times, resolves display names and country flags, then stores the result in Cloudflare KV.

The **frontend** (hosted on GitHub Pages) polls the worker API every 60 seconds and renders the leaderboard client-side with sorting, search, and pagination.

## Tech Stack

- **Backend**: Cloudflare Worker with Cron Triggers + KV storage
- **Frontend**: Vanilla HTML/CSS/JS on GitHub Pages
- **Data source**: Nadeo Live Services API (Leaderboard times) + Trackmania OAuth API (Player UUID to player displayname translation)

## Features

- Live combined ranking across all six maps (Stage 1 + Stage 2)
- Stage filter to view only Stage 1, only Stage 2, or all maps
- Per-map times and ranks with sortable columns
- Delta to 1st place (requires times on all six maps)
- Country flags
- Player search
- Auto-refresh every 60 seconds

## Project Structure

```
worker/          Cloudflare Worker (cron + API)
  src/index.js   Main worker code
  wrangler.toml  Cloudflare config
docs/            Frontend (GitHub Pages)
  index.html     Page structure
  script.js      Client-side logic
  style.css      Styling
```

## License

Not affiliated with Red Bull or Ubisoft Nadeo. Data sourced from Nadeo Live Services.
