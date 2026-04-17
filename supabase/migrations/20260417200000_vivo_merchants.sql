create table if not exists public.vivo_merchants (
  id                    uuid primary key default gen_random_uuid(),
  merchant_id           text unique not null,
  name                  text not null,
  domain                text not null,
  country               text not null default 'ES',
  currency              text not null default 'EUR',
  network               text,
  network_merchant_code text,
  affiliate_url_template text,
  publisher_id          text,
  needs_setup           boolean not null default true,
  enabled               boolean not null default true,
  categories            text[] not null default '{}',
  disclosure_text       text not null default 'Affiliate links included.',
  created_at            timestamptz not null default timezone('utc', now()),
  updated_at            timestamptz not null default timezone('utc', now())
);

create table if not exists public.vivo_merchant_audience_overrides (
  id          uuid primary key default gen_random_uuid(),
  merchant_id text not null references public.vivo_merchants(merchant_id) on delete cascade,
  audience_id text not null,
  enabled     boolean not null default true,
  boost_tags  jsonb not null default '[]',
  updated_at  timestamptz not null default timezone('utc', now()),
  unique(merchant_id, audience_id)
);

create index if not exists vivo_merchants_enabled_idx
  on public.vivo_merchants (enabled, needs_setup);

create index if not exists vivo_merchant_audience_overrides_merchant_idx
  on public.vivo_merchant_audience_overrides (merchant_id);

-- Seed: 15 merchants. All marked needs_setup=true — admin must enter publisher_id.
-- Awin template: awinmid=MERCHANT_CODE, awinaffid=PUBLISHER_ID
-- CJ template: click-PUBLISHER_ID-MERCHANT_CODE

insert into public.vivo_merchants
  (merchant_id, name, domain, country, currency, network, network_merchant_code, affiliate_url_template, needs_setup, enabled, categories)
values
  ('zara-es',          'Zara Spain',         'zara.com',           'ES', 'EUR', 'awin', '13623',  'https://www.awin1.com/cread.php?awinmid=13623&awinaffid={{publisher_id}}&ued={{url}}',   true, true, '{fashion,casualwear,beachwear}'),
  ('hm-es',            'H&M Spain',          'hm.com',             'ES', 'EUR', 'awin', '6614',   'https://www.awin1.com/cread.php?awinmid=6614&awinaffid={{publisher_id}}&ued={{url}}',    true, true, '{fashion,casualwear}'),
  ('uniqlo-eu',        'Uniqlo EU',          'uniqlo.com',         'EU', 'EUR', 'awin', '15192',  'https://www.awin1.com/cread.php?awinmid=15192&awinaffid={{publisher_id}}&ued={{url}}',   true, true, '{fashion,casualwear,sportswear}'),
  ('ikea-es',          'IKEA Spain',         'ikea.com',           'ES', 'EUR', 'awin', '6678',   'https://www.awin1.com/cread.php?awinmid=6678&awinaffid={{publisher_id}}&ued={{url}}',    true, true, '{home,furniture}'),
  ('decathlon-es',     'Decathlon ES',       'decathlon.es',       'ES', 'EUR', 'awin', '16558',  'https://www.awin1.com/cread.php?awinmid=16558&awinaffid={{publisher_id}}&ued={{url}}',   true, true, '{sports,outdoors,sportswear}'),
  ('mango-es',         'Mango ES',           'mango.com',          'ES', 'EUR', 'awin', '13608',  'https://www.awin1.com/cread.php?awinmid=13608&awinaffid={{publisher_id}}&ued={{url}}',   true, true, '{fashion,womenswear}'),
  ('elcorteingles-es', 'El Corte Inglés',    'elcorteingles.es',   'ES', 'EUR', 'awin', '10680',  'https://www.awin1.com/cread.php?awinmid=10680&awinaffid={{publisher_id}}&ued={{url}}',   true, true, '{fashion,home,electronics}'),
  ('nike-es',          'Nike ES',            'nike.com',           'ES', 'EUR', 'awin', '13660',  'https://www.awin1.com/cread.php?awinmid=13660&awinaffid={{publisher_id}}&ued={{url}}',   true, true, '{sports,sportswear,footwear}'),
  ('adidas-es',        'Adidas ES',          'adidas.es',          'ES', 'EUR', 'awin', '9585',   'https://www.awin1.com/cread.php?awinmid=9585&awinaffid={{publisher_id}}&ued={{url}}',    true, true, '{sports,sportswear,footwear}'),
  ('amazon-es',        'Amazon ES',          'amazon.es',          'ES', 'EUR', 'awin', '13557',  'https://www.awin1.com/cread.php?awinmid=13557&awinaffid={{publisher_id}}&ued={{url}}',   true, true, '{general,electronics,books}'),
  ('booking-com',      'Booking.com',        'booking.com',        'ES', 'EUR', 'awin', '596',    'https://www.awin1.com/cread.php?awinmid=596&awinaffid={{publisher_id}}&ued={{url}}',     true, true, '{travel,hotels}'),
  ('getyourguide-es',  'GetYourGuide ES',    'getyourguide.es',    'ES', 'EUR', 'awin', '19404',  'https://www.awin1.com/cread.php?awinmid=19404&awinaffid={{publisher_id}}&ued={{url}}',   true, true, '{travel,experiences,entertainment}'),
  ('fever-es',         'Fever ES',           'fever.com',          'ES', 'EUR', 'direct', null,   null,                                                                                     true, true, '{entertainment,events,nightlife}'),
  ('ticketmaster-es',  'Ticketmaster ES',    'ticketmaster.es',    'ES', 'EUR', 'cj',   '5361948','https://www.anrdoezrs.net/click-{{publisher_id}}-5361948?url={{url}}',                  true, true, '{entertainment,events,concerts}'),
  ('livenation-es',    'Live Nation ES',     'livenation.es',      'ES', 'EUR', null,    null,    null,                                                                                     false, true, '{entertainment,events,concerts}')
on conflict (merchant_id) do nothing;
