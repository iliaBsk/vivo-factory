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

  for (const passion of passions) {
    if (PASSION_SOURCES[passion]) add(PASSION_SOURCES[passion]);
  }

  for (const food of foodPreferences) {
    if (FOOD_SOURCES[food]) add(FOOD_SOURCES[food]);
  }

  if (movieGenres.length > 0) add(MOVIE_SOURCES);

  return sources;
}
