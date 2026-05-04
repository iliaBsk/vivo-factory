/**
 * Source catalog for onboarding-driven source seeding.
 * Maps audience location + interests to RSS feed sources.
 *
 * Note: sources already present in config/sources.json (static) are excluded
 * here to avoid duplicate fetching:
 *   bcn-news-lavanguardia, bcn-news-elpais-bcn, bcn-entertainment-timeout,
 *   bcn-entertainment-barcelona-metropolitan, bcn-travel-spottedbylocals,
 *   bcn-deals-zara, global-tech-hackernews, global-news-bbc, global-tech-verge
 *
 * Usage: getSourcesForAudience({ city, passions, foodPreferences, movieGenres })
 */

const CITY_SOURCES = {
  barcelona: [
    { id: 'bcn-news-elperiodico',       category: 'news',   type: 'rss', url: 'https://www.elperiodico.com/es/rss/rss_portada.xml',         weight: 0.9, location: 'barcelona', lang: 'es' },
    { id: 'bcn-news-elnacional',         category: 'news',   type: 'rss', url: 'https://www.elnacional.cat/es/feed',                         weight: 0.7, location: 'barcelona', lang: 'es' },
    { id: 'bcn-events-ajuntament',       category: 'events', type: 'rss', url: 'https://ajuntament.barcelona.cat/premsa/en/rss',             weight: 0.8, location: 'barcelona', lang: 'en' },
    { id: 'bcn-events-guiabcn',          category: 'events', type: 'rss', url: 'https://guia.barcelona.cat/ca/rss.xml',                      weight: 0.8, location: 'barcelona', lang: 'ca' },
    { id: 'bcn-food-lavanguardia-comer', category: 'food',   type: 'rss', url: 'https://www.lavanguardia.com/comer/rss/home.xml',            weight: 0.8, location: 'barcelona', lang: 'es' },
    { id: 'bcn-food-timeout-restaurants',category: 'food',   type: 'rss', url: 'https://www.timeout.com/barcelona/restaurants/feed.xml',    weight: 0.9, location: 'barcelona', lang: 'en' },
    { id: 'bcn-deals-20minutos',         category: 'deals',  type: 'rss', url: 'https://www.20minutos.es/rss/ofertas/',                      weight: 0.7, location: 'barcelona', lang: 'es' },
  ],
  madrid: [
    { id: 'mad-news-elmundo',   category: 'news',   type: 'rss', url: 'https://www.elmundo.es/rss/portada.xml',                weight: 0.9, location: 'madrid', lang: 'es' },
    { id: 'mad-events-timeout', category: 'events', type: 'rss', url: 'https://www.timeout.com/madrid/feed.xml',               weight: 0.9, location: 'madrid', lang: 'en' },
    { id: 'mad-food-timeout',   category: 'food',   type: 'rss', url: 'https://www.timeout.com/madrid/restaurants/feed.xml',  weight: 0.8, location: 'madrid', lang: 'en' },
  ],
  london: [
    { id: 'lon-news-guardian',   category: 'news',   type: 'rss', url: 'https://www.theguardian.com/uk/rss',                  weight: 0.9, location: 'london', lang: 'en' },
    { id: 'lon-events-timeout',  category: 'events', type: 'rss', url: 'https://www.timeout.com/london/feed.xml',             weight: 0.9, location: 'london', lang: 'en' },
    { id: 'lon-deals-hotukdeals',category: 'deals',  type: 'rss', url: 'https://www.hotukdeals.com/rss/deals',                weight: 0.8, location: 'london', lang: 'en' },
  ],
  paris: [
    { id: 'par-news-lemonde',   category: 'news',   type: 'rss', url: 'https://www.lemonde.fr/rss/une.xml',                   weight: 1.0, location: 'paris', lang: 'fr' },
    { id: 'par-events-timeout', category: 'events', type: 'rss', url: 'https://www.timeout.com/paris/feed.xml',               weight: 0.9, location: 'paris', lang: 'en' },
    { id: 'par-food-timeout',   category: 'food',   type: 'rss', url: 'https://www.timeout.com/paris/restaurants/feed.xml',  weight: 0.8, location: 'paris', lang: 'en' },
  ],
};

const PASSION_SOURCES = {
  technology: [
    { id: 'global-tech-techcrunch',    category: 'tech',    type: 'rss', url: 'https://techcrunch.com/feed/',                         weight: 0.8, location: 'global' },
    { id: 'global-tech-wired',         category: 'tech',    type: 'rss', url: 'https://www.wired.com/feed/rss',                       weight: 0.7, location: 'global' },
    { id: 'global-tech-mit',           category: 'tech',    type: 'rss', url: 'https://www.technologyreview.com/feed/',               weight: 0.7, location: 'global' },
  ],
  'arts-culture': [
    { id: 'global-arts-hyperallergic', category: 'entertainment', type: 'rss', url: 'https://hyperallergic.com/feed/',                weight: 0.9, location: 'global' },
    { id: 'global-arts-artnewspaper',  category: 'entertainment', type: 'rss', url: 'https://www.theartnewspaper.com/rss',            weight: 0.8, location: 'global' },
    { id: 'global-arts-dezeen',        category: 'entertainment', type: 'rss', url: 'https://www.dezeen.com/feed/',                   weight: 0.7, location: 'global' },
    { id: 'global-arts-designboom',    category: 'entertainment', type: 'rss', url: 'https://www.designboom.com/feed/',               weight: 0.7, location: 'global' },
  ],
  'health-fitness': [
    { id: 'global-health-menshealth',  category: 'health',  type: 'rss', url: 'https://www.menshealth.com/rss/all.xml/',             weight: 0.9, location: 'global' },
    { id: 'global-health-runners',     category: 'health',  type: 'rss', url: 'https://www.runnersworld.com/rss/all.xml/',           weight: 0.8, location: 'global' },
    { id: 'global-health-healthline',  category: 'health',  type: 'rss', url: 'https://www.healthline.com/rss/health-news',         weight: 0.7, location: 'global' },
  ],
  sports: [
    { id: 'global-sports-skysports',   category: 'sports',  type: 'rss', url: 'https://www.skysports.com/rss/12040',                weight: 0.8, location: 'global' },
    { id: 'global-sports-marca',       category: 'sports',  type: 'rss', url: 'https://e00-marca.uecdn.es/rss/portada.xml',         weight: 0.8, location: 'global' },
    { id: 'global-sports-espn',        category: 'sports',  type: 'rss', url: 'https://www.espn.com/espn/rss/news',                 weight: 0.7, location: 'global' },
  ],
  investing: [
    { id: 'global-finance-marketwatch',category: 'finance', type: 'rss', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', weight: 0.9, location: 'global' },
    { id: 'global-finance-investing',  category: 'finance', type: 'rss', url: 'https://www.investing.com/rss/news.rss',             weight: 0.8, location: 'global' },
    { id: 'global-finance-ft',         category: 'finance', type: 'rss', url: 'https://www.ft.com/world?format=rss',               weight: 0.8, location: 'global' },
  ],
  travel: [
    { id: 'global-travel-lonelyplanet',category: 'travel',  type: 'rss', url: 'https://www.lonelyplanet.com/news/feed',             weight: 0.9, location: 'global' },
    { id: 'global-travel-natgeo',      category: 'travel',  type: 'rss', url: 'https://www.nationalgeographic.com/travel/article/rss', weight: 0.8, location: 'global' },
    { id: 'global-travel-cntraveler',  category: 'travel',  type: 'rss', url: 'https://www.cntraveler.com/feed/rss',               weight: 0.7, location: 'global' },
  ],
  family: [
    { id: 'global-family-parents',     category: 'family',  type: 'rss', url: 'https://www.parents.com/feeds/articles/',           weight: 0.8, location: 'global' },
    { id: 'global-family-babycenter',  category: 'family',  type: 'rss', url: 'https://www.babycenter.com/rss/news',               weight: 0.7, location: 'global' },
  ],
  'food-lifestyle': [
    { id: 'global-food-bonappetit',    category: 'food',    type: 'rss', url: 'https://www.bonappetit.com/feed/rss',               weight: 0.9, location: 'global' },
    { id: 'global-food-eater',         category: 'food',    type: 'rss', url: 'https://www.eater.com/rss/index.xml',               weight: 0.9, location: 'global' },
    { id: 'global-food-seriouseats',   category: 'food',    type: 'rss', url: 'https://www.seriouseats.com/feeds/all.rss.xml',     weight: 0.8, location: 'global' },
  ],

  // ── China / Asia tech ecosystem ──────────────────────────────────────────
  'china-tech': [
    { id: 'china-tech-technode',       category: 'tech',    type: 'rss', url: 'https://technode.com/feed/',                        weight: 1.0, location: 'china' },
    { id: 'china-tech-thechinaproject',category: 'tech',    type: 'rss', url: 'https://thechinaproject.com/feed/',                 weight: 0.9, location: 'china' },
    { id: 'china-tech-supchina',       category: 'tech',    type: 'rss', url: 'https://supchina.com/feed/',                        weight: 0.9, location: 'china' },
    { id: 'china-tech-nikkeisia',      category: 'tech',    type: 'rss', url: 'https://asia.nikkei.com/rss/feed/news',             weight: 0.9, location: 'asia' },
    { id: 'china-tech-scmp',           category: 'tech',    type: 'rss', url: 'https://www.scmp.com/rss/91/feed',                  weight: 0.8, location: 'china' },
    { id: 'china-tech-caixin',         category: 'finance', type: 'rss', url: 'https://www.caixinglobal.com/rss/rss.xml',          weight: 0.9, location: 'china' },
    { id: 'china-tech-wirechina',      category: 'tech',    type: 'rss', url: 'https://www.thewirechina.com/feed/',                weight: 0.8, location: 'china' },
    { id: 'china-tech-diplomat',       category: 'tech',    type: 'rss', url: 'https://thediplomat.com/feed/',                     weight: 0.8, location: 'asia' },
  ],

  // ── Venture capital & startup ecosystem ──────────────────────────────────
  'venture-capital': [
    { id: 'vc-crunchbase',             category: 'finance', type: 'rss', url: 'https://news.crunchbase.com/feed/',                 weight: 1.0, location: 'global' },
    { id: 'vc-strictlyvc',            category: 'finance', type: 'rss', url: 'https://strictlyvc.com/feed/',                      weight: 0.9, location: 'global' },
    { id: 'vc-a16z',                   category: 'tech',    type: 'rss', url: 'https://a16z.com/feed/',                            weight: 0.9, location: 'global' },
    { id: 'vc-ycombinator',            category: 'tech',    type: 'rss', url: 'https://www.ycombinator.com/blog.rss',              weight: 0.8, location: 'global' },
    { id: 'vc-firstround',             category: 'tech',    type: 'rss', url: 'https://review.firstround.com/feed.xml',            weight: 0.9, location: 'global' },
    { id: 'vc-bothsides',              category: 'finance', type: 'rss', url: 'https://bothsidesofthetable.com/feed',              weight: 0.8, location: 'global' },
    { id: 'vc-the-generalist',         category: 'finance', type: 'rss', url: 'https://thegeneralist.substack.com/feed',           weight: 0.9, location: 'global' },
    { id: 'vc-not-boring',             category: 'tech',    type: 'rss', url: 'https://www.notboring.co/feed',                     weight: 0.9, location: 'global' },
    { id: 'vc-napkin-math',            category: 'finance', type: 'rss', url: 'https://napkinmath.substack.com/feed',              weight: 0.8, location: 'global' },
    { id: 'vc-cbinsights',             category: 'finance', type: 'rss', url: 'https://www.cbinsights.com/research/feed/',         weight: 0.8, location: 'global' },
  ],

  // ── Geopolitics & macro strategy ─────────────────────────────────────────
  'geopolitics': [
    { id: 'geo-warontherocks',         category: 'news',    type: 'rss', url: 'https://warontherocks.com/feed/',                   weight: 1.0, location: 'global' },
    { id: 'geo-foreignaffairs',        category: 'news',    type: 'rss', url: 'https://www.foreignaffairs.com/rss.xml',            weight: 0.9, location: 'global' },
    { id: 'geo-chinatalk',             category: 'news',    type: 'rss', url: 'https://chinatalk.substack.com/feed',               weight: 1.0, location: 'china' },
    { id: 'geo-macropolo',             category: 'news',    type: 'rss', url: 'https://macropolo.org/feed/',                       weight: 0.9, location: 'china' },
    { id: 'geo-chinai',                category: 'tech',    type: 'rss', url: 'https://chinai.substack.com/feed',                  weight: 0.9, location: 'china' },
    { id: 'geo-sinocism',              category: 'news',    type: 'rss', url: 'https://sinocism.com/feed',                         weight: 0.8, location: 'china' },
  ],

  // ── AI research & policy ─────────────────────────────────────────────────
  'ai-research': [
    { id: 'ai-arxiv',                  category: 'tech',    type: 'rss', url: 'https://arxiv.org/rss/cs.AI',                       weight: 1.0, location: 'global' },
    { id: 'ai-importai',               category: 'tech',    type: 'rss', url: 'https://importai.substack.com/feed',                weight: 0.9, location: 'global' },
    { id: 'ai-ahead-of-ai',            category: 'tech',    type: 'rss', url: 'https://magazine.sebastianraschka.com/feed',        weight: 0.9, location: 'global' },
    { id: 'ai-gradient-flow',          category: 'tech',    type: 'rss', url: 'https://gradientflow.com/feed/',                    weight: 0.8, location: 'global' },
    { id: 'ai-ben-evans',              category: 'tech',    type: 'rss', url: 'https://www.ben-evans.com/benedictevans?format=rss', weight: 0.9, location: 'global' },
    { id: 'ai-stratechery',            category: 'tech',    type: 'rss', url: 'https://stratechery.com/feed/',                     weight: 1.0, location: 'global' },
  ],

  // ── Biotech & life sciences ───────────────────────────────────────────────
  'biotech': [
    { id: 'bio-statnews',              category: 'health',  type: 'rss', url: 'https://www.statnews.com/feed/',                    weight: 1.0, location: 'global' },
    { id: 'bio-fiercebitoech',         category: 'health',  type: 'rss', url: 'https://www.fiercebiotech.com/rss/xml',             weight: 0.9, location: 'global' },
    { id: 'bio-biopharma-dive',        category: 'health',  type: 'rss', url: 'https://www.biopharmadive.com/feeds/news/',         weight: 0.8, location: 'global' },
    { id: 'bio-endpoints',             category: 'health',  type: 'rss', url: 'https://endpts.com/feed/',                          weight: 0.9, location: 'global' },
  ],

  // ── Quant finance & macro ─────────────────────────────────────────────────
  'quant-macro': [
    { id: 'macro-zerohedge',           category: 'finance', type: 'rss', url: 'https://feeds.feedburner.com/zerohedge/feed',       weight: 0.7, location: 'global' },
    { id: 'macro-mauldin',             category: 'finance', type: 'rss', url: 'https://www.mauldineconomics.com/feed',             weight: 0.8, location: 'global' },
    { id: 'macro-calculated-risk',     category: 'finance', type: 'rss', url: 'https://www.calculatedriskblog.com/feeds/posts/default', weight: 0.8, location: 'global' },
    { id: 'macro-gavekal',             category: 'finance', type: 'rss', url: 'https://gavekal.com/feed/',                         weight: 0.9, location: 'global' },
    { id: 'macro-naked-capitalism',    category: 'finance', type: 'rss', url: 'https://www.nakedcapitalism.com/feed',              weight: 0.7, location: 'global' },
  ],
};

const FOOD_SOURCES = {
  mediterranean: [
    { id: 'global-food-olivemag',      category: 'food',    type: 'rss', url: 'https://www.olivemagazine.com/feed/',              weight: 0.7, location: 'global' },
  ],
  japanese: [
    { id: 'global-food-japantimes',    category: 'food',    type: 'rss', url: 'https://www.japantimes.co.jp/feed/rss/',           weight: 0.6, location: 'global' },
  ],
  italian: [
    { id: 'global-food-italianfood',   category: 'food',    type: 'rss', url: 'https://www.lacucinaitaliana.com/feed',            weight: 0.6, location: 'global' },
  ],
  'middle-eastern': [
    { id: 'global-food-middleeast',    category: 'food',    type: 'rss', url: 'https://www.annainthekitchen.com/feed/',           weight: 0.6, location: 'global' },
  ],
};

const MOVIE_SOURCES = [
  { id: 'global-ent-variety',          category: 'entertainment', type: 'rss', url: 'https://variety.com/feed/',                 weight: 0.8, location: 'global' },
  { id: 'global-ent-screenrant',       category: 'entertainment', type: 'rss', url: 'https://screenrant.com/feed/',              weight: 0.7, location: 'global' },
  { id: 'global-ent-deadline',         category: 'entertainment', type: 'rss', url: 'https://deadline.com/feed/',                weight: 0.7, location: 'global' },
];

PASSION_SOURCES['gaming'] = [
  { id: 'global-gaming-kotaku',        category: 'entertainment', type: 'rss', url: 'https://kotaku.com/rss',                    weight: 0.9, location: 'global' },
  { id: 'global-gaming-polygon',       category: 'entertainment', type: 'rss', url: 'https://www.polygon.com/rss/index.xml',     weight: 0.9, location: 'global' },
  { id: 'global-gaming-ign',           category: 'entertainment', type: 'rss', url: 'https://feeds.ign.com/ign/all',             weight: 0.8, location: 'global' },
  { id: 'global-gaming-gamedeveloper', category: 'entertainment', type: 'rss', url: 'https://www.gamedeveloper.com/rss.xml',     weight: 0.8, location: 'global' },
];

PASSION_SOURCES['productivity'] = [
  { id: 'global-prod-lennysnewsletter', category: 'tech',      type: 'rss', url: 'https://www.lennysnewsletter.com/feed',        weight: 1.0, location: 'global' },
  { id: 'global-prod-aliabdaal',        category: 'tech',      type: 'rss', url: 'https://aliabdaal.com/newsletter/rss/',         weight: 0.9, location: 'global' },
  { id: 'global-prod-bakadesuyo',       category: 'tech',      type: 'rss', url: 'https://bakadesuyo.com/feed/',                  weight: 0.8, location: 'global' },
  { id: 'global-prod-hbr',              category: 'tech',      type: 'rss', url: 'https://hbr.org/stories.rss',                  weight: 0.8, location: 'global' },
  { id: 'global-prod-fs-blog',          category: 'tech',      type: 'rss', url: 'https://fs.blog/feed/',                         weight: 0.9, location: 'global' },
];

PASSION_SOURCES['lifestyle'] = [
  { id: 'global-life-outsideonline',    category: 'lifestyle', type: 'rss', url: 'https://www.outsideonline.com/feed/',           weight: 0.9, location: 'global' },
  { id: 'global-life-gq',              category: 'lifestyle', type: 'rss', url: 'https://www.gq.com/feed/rss',                   weight: 0.8, location: 'global' },
  { id: 'global-life-monocle',         category: 'lifestyle', type: 'rss', url: 'https://monocle.com/feed/',                     weight: 0.8, location: 'global' },
  { id: 'global-life-dwell',           category: 'lifestyle', type: 'rss', url: 'https://www.dwell.com/feed',                    weight: 0.7, location: 'global' },
];

PASSION_SOURCES['sailing'] = [
  { id: 'global-sail-sailing-world',   category: 'sports',    type: 'rss', url: 'https://www.sailingworld.com/feed/',            weight: 1.0, location: 'global' },
  { id: 'global-sail-practical-sailor',category: 'sports',    type: 'rss', url: 'https://www.practical-sailor.com/feed',         weight: 0.9, location: 'global' },
  { id: 'global-sail-yachting-monthly',category: 'sports',    type: 'rss', url: 'https://www.yachtingmonthly.com/feed',          weight: 0.9, location: 'global' },
];

PASSION_SOURCES['semiconductors'] = [
  { id: 'global-semi-semianalysis',    category: 'tech',      type: 'rss', url: 'https://www.semianalysis.com/feed',             weight: 1.0, location: 'global' },
  { id: 'global-semi-eetimes',         category: 'tech',      type: 'rss', url: 'https://www.eetimes.com/feed/',                 weight: 0.9, location: 'global' },
  { id: 'global-semi-ieee',            category: 'tech',      type: 'rss', url: 'https://spectrum.ieee.org/feeds/feed.rss',      weight: 0.9, location: 'global' },
  { id: 'global-semi-chipstrat',       category: 'tech',      type: 'rss', url: 'https://www.chipstrat.com/feed',                weight: 0.9, location: 'global' },
];

PASSION_SOURCES['open-source'] = [
  { id: 'global-oss-github-blog',      category: 'tech',      type: 'rss', url: 'https://github.blog/feed/',                    weight: 1.0, location: 'global' },
  { id: 'global-oss-lwn',              category: 'tech',      type: 'rss', url: 'https://lwn.net/headlines/rss',                 weight: 0.9, location: 'global' },
  { id: 'global-oss-thenewstack',      category: 'tech',      type: 'rss', url: 'https://thenewstack.io/feed/',                  weight: 0.8, location: 'global' },
  { id: 'global-oss-hnrss',            category: 'tech',      type: 'rss', url: 'https://hnrss.org/frontpage',                   weight: 0.9, location: 'global' },
];

PASSION_SOURCES['growth-marketing'] = [
  { id: 'global-growth-lenny',         category: 'tech',          type: 'rss', url: 'https://www.lennysnewsletter.com/feed',     weight: 1.0, location: 'global' },
  { id: 'global-growth-reforge',       category: 'tech',          type: 'rss', url: 'https://www.reforge.com/blog/rss.xml',      weight: 0.9, location: 'global' },
  { id: 'global-growth-andrew',        category: 'tech',          type: 'rss', url: 'https://andrewchen.com/feed/',              weight: 1.0, location: 'global' },
  { id: 'global-growth-product-led',   category: 'tech',          type: 'rss', url: 'https://productled.com/blog/feed/',         weight: 0.8, location: 'global' },
];

// Aliases: maps normalized interest tokens → PASSION_SOURCES keys
const PASSION_ALIASES = {
  // AI / ML
  'ai':                      'ai-research',
  'artificial-intelligence': 'ai-research',
  'machine-learning':        'ai-research',
  'deep-learning':           'ai-research',
  // VC / startups / growth
  'venture-capital':         'venture-capital',
  'startup':                 'venture-capital',
  'startups':                'venture-capital',
  'network-effects':         'venture-capital',
  'marketplace-economics':   'venture-capital',
  'marketplace':             'venture-capital',
  'product-market-fit':      'venture-capital',
  // Growth / consumer
  'growth':                  'growth-marketing',
  'growth-metrics':          'growth-marketing',
  'consumer-psychology':     'growth-marketing',
  'user-acquisition':        'growth-marketing',
  'retention':               'growth-marketing',
  // Finance / quant
  'quant':                   'quant-macro',
  'quantitative-finance':    'quant-macro',
  'macro':                   'quant-macro',
  'macroeconomics':          'quant-macro',
  // Biotech
  'biotech':                 'biotech',
  'life-sciences':           'biotech',
  'pharma':                  'biotech',
  // Geopolitics
  'geopolitics':             'geopolitics',
  'china':                   'geopolitics',
  'us-china':                'geopolitics',
  // Gaming
  'gaming':                  'gaming',
  'video-games':             'gaming',
  'esports':                 'gaming',
  // Productivity
  'productivity':            'productivity',
  'deep-work':               'productivity',
  'self-improvement':        'productivity',
  // Lifestyle
  'lifestyle':               'lifestyle',
  'local_life':              'lifestyle',
  'style':                   'lifestyle',
  // Fitness
  'fitness':                 'health-fitness',
  'health-fitness':          'health-fitness',
  'health':                  'health-fitness',
  'running':                 'health-fitness',
  'gym':                     'health-fitness',
  // Sailing / outdoors
  'sailing':                 'sailing',
  'outdoor':                 'sailing',
  'outdoors':                'sailing',
  // Semiconductors / hardware
  'semiconductors':          'semiconductors',
  'semiconductor':           'semiconductors',
  'chips':                   'semiconductors',
  'hardware':                'semiconductors',
  // Open source
  'open-source':             'open-source',
  'open source':             'open-source',
  'opensource':              'open-source',
  // China / Asia tech (normalized variants)
  'china-tech':              'china-tech',
  'china tech':              'china-tech',
  'asia-tech':               'china-tech',
  // AI variants
  'ai_tools':                'ai-research',
  'ai tools':                'ai-research',
  'ai research':             'ai-research',
  'llm':                     'ai-research',
  'nlp':                     'ai-research',
  // VC variants
  'venture capital':         'venture-capital',
  'vc':                      'venture-capital',
  'angel-investing':         'venture-capital',
  'angel investing':         'venture-capital',
  'early-stage':             'venture-capital',
};

/**
 * Returns deduplicated sources for an audience based on their onboarding profile.
 * Does NOT include sources already in config/sources.json (static catalog).
 * @param {{ city?: string, passions?: string[], foodPreferences?: string[], movieGenres?: string[] }} profile
 * @returns {Array<object>}
 */
export function getSourcesForAudience({ city = '', passions = [], foodPreferences = [], movieGenres = [] }) {
  const seen = new Set();
  const sources = [];

  const add = (list) => {
    for (const src of list) {
      if (!seen.has(src.id)) {
        seen.add(src.id);
        sources.push(src);
      }
    }
  };

  const cityKey = city.toLowerCase().trim();
  if (CITY_SOURCES[cityKey]) add(CITY_SOURCES[cityKey]);

  const resolvePassion = (passion) => PASSION_ALIASES[passion] ?? passion;
  const seenCategories = new Set();
  for (const passion of passions) {
    const key = resolvePassion(passion);
    if (!seenCategories.has(key) && PASSION_SOURCES[key]) {
      seenCategories.add(key);
      add(PASSION_SOURCES[key]);
    }
  }

  for (const food of foodPreferences) {
    if (FOOD_SOURCES[food]) add(FOOD_SOURCES[food]);
  }

  if (movieGenres.length > 0) add(MOVIE_SOURCES);

  return sources;
}
