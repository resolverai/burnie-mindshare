# Context Pack Builder v2.0 - README

## Purpose

Generate renewable context packs for content generation to solve the **"context exhaustion"** problem for SMBs and web3 projects.

**Key Features:**
- ✅ **Maximum 2 context packs per run** (configurable)
- ✅ **Intelligent keyword generation** via OpenAI LLM
- ✅ **Automatic timezone detection** for client location
- ✅ **Local context search** via OpenAI web search
- ✅ **Comprehensive logging** of all API calls and responses
- ✅ **JSON output** saved to file

## Installation

```bash
# Install dependencies
pip install xai-sdk python-dateutil feedparser requests pytz openai python-dotenv

# Environment variables are loaded from python-ai-backend/.env automatically
```

## Environment Variables

The script loads environment variables from `python-ai-backend/.env`:

```
OPENAI_API_KEY=sk-proj-...     # Required for keyword generation & local context
XAI_API_KEY=xai-...             # Required for Twitter/X trends (Grok)
EVENTBRITE_TOKEN=...            # Optional (falls back to OpenAI if missing)
```

## Usage

```bash
cd burnie-influencer-platform/ai
python context_pack_builder.py
```

##How It Works

### **Two-Stage LLM Approach**

#### **Stage 1: Intelligent Keyword Generation (OpenAI Chat Completions)**

**Input:**
```python
signup = {
    "industry": "Speech Therapy & Wellness",
    "city": "Toronto",
    "region": "Ontario",
    "country": "Canada",
    "country_code": "CA",
    "website": "https://speechwellnesscentre.com",
}
```

**LLM Call (gpt-4o-mini):**
- System prompt guides LLM to generate:
  - **RSS Feed Keywords** (10-20 broad industry terms)
  - **Local Context Keywords** (10-20 geo-specific search queries)
  - **Timezone** (IANA string like "America/Toronto")

**Example Output:**
```json
{
  "keywords_rss": [
    "speech therapy",
    "stuttering",
    "child speech development",
    "SLP",
    "articulation disorders",
    "language development",
    "voice therapy",
    "AAC",
    "workplace communication"
  ],
  "keywords_local_context": [
    "Toronto schools speech programs 2025",
    "Ontario child wellness initiatives",
    "Toronto speech therapy clinics",
    "GTA child health programs",
    "Toronto TDSB speech language services",
    "Ontario Ministry of Health speech programs"
  ],
  "timezone": "America/Toronto"
}
```

**Logging:** Full OpenAI response is logged to console.

---

#### **Stage 2: Local Context Search (OpenAI with Web Search)**

**Input:** `keywords_local_context` from Stage 1

**Purpose:** Fetch fresh, relevant local information:
- Local businesses, clinics, centers, startups
- Schools, colleges, universities (programs/initiatives)
- Community organizations, nonprofits
- Regional news, events, trends
- Government programs and resources

**API Structure:**
```python
response = openai_client.responses.create(
    model="gpt-5-mini",  # Supports web_search tool
    tools=[{
        "type": "web_search",
        "user_location": {
            "type": "approximate",
            "country": "CA",  # ISO country code
            "city": "Toronto",
            "region": "Ontario"
        }
    }],
    tool_choice="auto",
    input="Find recent information about <keywords> in <location>..."
)
```

**Example for Speech Therapy Business:**
- Toronto schools implementing speech programs
- Ontario government initiatives for child wellness
- Local speech therapy clinics and their services
- GTA health programs for kids
- Recent news about speech therapy in Toronto

**Example for DeFi Web3 Business:**
- Bay Area crypto startups and funding
- San Francisco blockchain events
- Local DeFi meetups and conferences
- Regional crypto regulations
- Silicon Valley Web3 ecosystem news

**Logging:** Full OpenAI response is logged to console.

---

### **Data Sources**

| Source | Implementation | Purpose |
|--------|---------------|---------|
| **RSS Feeds** | `feedparser` | Industry news (dynamically filtered by `keywords_rss`) |
| **Eventbrite** | Official API | Local events, workshops (50km radius, space-separated keywords) |
| **Holidays** | Nager.Date API | Public holidays, cultural events |
| **Local Context** | OpenAI Responses API with `web_search` tool | Local businesses, schools, news |
| **Twitter/X** | Grok `grok-4-fast-reasoning` with `x_source()` | Trending topics (last 7 days, no OAuth) |

---

## Example Console Output

```
📁 Loading environment variables from: .../python-ai-backend/.env
✅ OpenAI client initialized

================================================================================
🎯 CONTEXT PACK BUILDER v2.0
================================================================================
✅ OPENAI_API_KEY: sk-proj-rx_HDMCGEYkQh...
✅ XAI_API_KEY: xai-oVaaWl7uj2JIOE...
✅ EVENTBRITE_TOKEN: Not configured
================================================================================

================================================================================
🚀 STARTING CONTEXT PACK GENERATION
================================================================================
Client ID: client_demo_001
Industry: Speech Therapy & Wellness
Location: Toronto, Ontario, Canada
Max Packs: 2
================================================================================

================================================================================
🤖 OPENAI KEYWORD GENERATION (First LLM Call)
================================================================================
Industry: Speech Therapy & Wellness
Location: Toronto, Ontario, Canada
Website: https://speechwellnesscentre.com
  → Calling OpenAI (gpt-4o-mini)...
  ← Received response (1245 chars)

────────────────────────────────────────────────────────────────────────────────
📄 OPENAI RAW OUTPUT:
────────────────────────────────────────────────────────────────────────────────
```json
{
  "keywords_rss": [
    "speech therapy",
    "stuttering",
    "child speech development",
    "SLP",
    "articulation disorders",
    "language development",
    "voice therapy",
    "AAC",
    "workplace communication",
    "accent modification"
  ],
  "keywords_local_context": [
    "Toronto schools speech programs 2025",
    "Ontario child wellness initiatives",
    "Toronto speech therapy clinics",
    "GTA child health programs",
    "Toronto TDSB speech language services"
  ],
  "timezone": "America/Toronto"
}
```
────────────────────────────────────────────────────────────────────────────────

✅ Extracted 10 RSS keywords
✅ Extracted 5 local context keywords
✅ Timezone: America/Toronto
================================================================================

================================================================================
📰 FETCHING RSS FEEDS
================================================================================
Keywords: speech therapy, stuttering, child speech development, SLP, articulation disorders...
Location: Toronto, Ontario, Canada
  → Parsing feed: https://www.medicalnewstoday.com/rss
    ✓ Found 3 relevant items
  → Parsing feed: https://www.psychologytoday.com/intl/front/feed
    ✓ Found 2 relevant items

✅ Total RSS items: 5

================================================================================
🎟️  FETCHING EVENTBRITE EVENTS
================================================================================
Location: Toronto, Ontario, Canada
Keywords: speech therapy, stuttering, child speech development, SLP, articulation disorders...
  ℹ️  Eventbrite API token not configured (skipping)

✅ Total Eventbrite items: 0

================================================================================
📅 FETCHING PUBLIC HOLIDAYS
================================================================================
Country: CA
Year: 2025
  → Calling: https://date.nager.at/api/v3/PublicHolidays/2025/CA
    ✓ Found 14 holidays

✅ Total holiday items: 14

================================================================================
🌐 OPENAI LOCAL CONTEXT SEARCH (Second Call with Web Search)
================================================================================
Keywords: Toronto schools speech programs 2025, Ontario child wellness initiatives, Toronto speech therapy clinics...
Location: Toronto, Ontario, Canada
  → Calling OpenAI with web search (gpt-4o-mini)...
  ← Received response (982 chars)

────────────────────────────────────────────────────────────────────────────────
📄 OPENAI LOCAL CONTEXT RAW OUTPUT:
────────────────────────────────────────────────────────────────────────────────
[
  {
    "title": "TDSB Speech and Language Services",
    "url": "https://www.tdsb.on.ca/...",
    "summary": "Toronto District School Board offers comprehensive speech and language support...",
    "published_date": "2025-01-10"
  },
  ...
]
────────────────────────────────────────────────────────────────────────────────

    ✓ Extracted 4 items from JSON

✅ Total local context items: 4

================================================================================
🐦 GROK TWITTER/X SEARCH
================================================================================
Keywords: speech therapy, stuttering, child speech development, SLP, articulation disorders...
Location: Toronto, Ontario, Canada
  Date range: 2025-01-01 to 2025-01-11
  → Calling Grok...
  ← Received response (756 chars)

────────────────────────────────────────────────────────────────────────────────
📄 GROK TWITTER RAW OUTPUT:
────────────────────────────────────────────────────────────────────────────────
[
  {
    "title": "#SpeechTherapy trending",
    "url": "https://twitter.com/...",
    "summary": "Recent discussions about innovative speech therapy techniques...",
    "published_date": "2025-01-09T14:30:00"
  },
  ...
]
────────────────────────────────────────────────────────────────────────────────

    ✓ Extracted 3 items from JSON

✅ Total Twitter items: 3

================================================================================
📊 CONTEXT ITEMS SUMMARY
================================================================================
RSS: 5
Eventbrite: 0
Holidays: 14
Local Context (OpenAI): 4
Twitter (Grok): 3
Total (after deduplication): 26
================================================================================

🕒 Items after 30-day recency filter: 23

================================================================================
📦 BUILDING CONTEXT PACKS
================================================================================

  ✓ Pack 1: 6 items, freshness=0.89, diversity=0.74
  ✓ Pack 2: 6 items, freshness=0.82, diversity=0.68

  → 2 new packs after deduplication against existing packs

================================================================================
✅ CONTEXT PACK GENERATION COMPLETE
================================================================================
New packs: 2
Total packs: 2
================================================================================

================================================================================
💾 OUTPUT SAVED TO: context_packs_client_demo_001_20250111_143025.json
================================================================================

Generated 2 context packs with 12 total items

To view the output:
  cat context_packs_client_demo_001_20250111_143025.json | jq .
```

---

## Output Structure

```json
{
  "generated_at": "2025-01-11T14:30:25-05:00",
  "client_id": "client_demo_001",
  "signup": {
    "industry": "Speech Therapy & Wellness",
    "city": "Toronto",
    "region": "Ontario",
    "country": "Canada",
    "country_code": "CA",
    "website": "https://speechwellnesscentre.com"
  },
  "new_packs_count": 2,
  "all_packs_count": 2,
  "new_packs": [
    {
      "id": "uuid",
      "client_id": "client_demo_001",
      "created_at": "2025-01-11T14:30:25-05:00",
      "use_before": "2025-01-20T09:00:00-05:00",
      "freshness_score": 0.89,
      "diversity_score": 0.74,
      "items": [
        {
          "id": "uuid",
          "source": "local",
          "title": "TDSB Speech and Language Services",
          "url": "https://www.tdsb.on.ca/...",
          "summary": "Toronto District School Board offers comprehensive speech and language support...",
          "location": "Toronto, Ontario, Canada",
          "industry_tags": [],
          "topic_tags": ["local", "context", "fresh"],
          "published_at": "2025-01-10T00:00:00-05:00",
          "event_start": null,
          "event_end": null,
          "extra": {}
        }
        // ... 5 more items
      ],
      "keywords": [
        "speech therapy",
        "Toronto schools speech programs 2025",
        ...
      ],
      "notes": "Auto-generated pack"
    }
    // ... 1 more pack
  ]
}
```

---

## Configuration

Edit constants in the script:

```python
RECENCY_DAYS_DEFAULT = 30      # Filter content older than N days
TWITTER_RECENCY_DAYS = 10      # Twitter trends lookback
MAX_ITEMS_PER_SOURCE = 25      # Max items per source
MAX_CONTEXT_PACKS = 2          # Max packs per run
ITEMS_PER_PACK = 6             # Items per pack
```

---

## Customization

Edit the `signup` dictionary in `main()`:

**SMB Example** (default):
```python
signup = {
    "industry": "Speech Therapy & Wellness",
    "city": "Toronto",
    "region": "Ontario",
    "country": "Canada",
    "country_code": "CA",
    "website": "https://speechwellnesscentre.com",
}
```

**Web3 Example**:
```python
signup = {
    "industry": "DeFi",
    "city": "San Francisco",
    "region": "California",
    "country": "United States",
    "country_code": "US",
    "website": "https://example-defi.com",
}
```

---

## Key Changes from v1.0

✅ **Loads .env from python-ai-backend** (like `video_generation.py`)  
✅ **Maximum 2 packs per run** (instead of 30)  
✅ **OpenAI keyword generation** (replaces hardcoded expansions)  
✅ **Automatic timezone detection** (from LLM)  
✅ **OpenAI local context search** (replaces Grok web search)  
✅ **Comprehensive API call logging** (full responses printed)  
✅ **JSON output dumped to file** (ready for database integration)

---

## Next Steps (Integration)

1. **Database models** (TypeORM for `ContextPack` and `ContextItem`)
2. **Background job** (cron to generate packs daily/weekly)
3. **API endpoint** (trigger on-demand generation)
4. **Content generation integration** (inject packs into Grok prompts)
5. **Pack rotation** (mark as "used", prioritize by `use_before`)

---

## Troubleshooting

### "OPENAI_API_KEY not found"
- Check `python-ai-backend/.env` exists
- Verify `OPENAI_API_KEY` is set

### "XAI_API_KEY not found"
- Twitter/X search will be skipped
- Script will still work (RSS + local context + holidays)

### Empty local context results
- OpenAI's web search may be limited
- Try broader `keywords_local_context`
- Check system prompt clarity

---

## Support

For questions, check:
- OpenAI API docs: https://platform.openai.com/docs
- Grok/XAI docs: https://docs.x.ai/
- Eventbrite API: https://www.eventbrite.com/platform/api
