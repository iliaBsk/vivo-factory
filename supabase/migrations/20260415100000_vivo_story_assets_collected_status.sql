begin;

alter type public.vivo_story_status
  add value if not exists 'assets_collected' before 'asset_generating';

commit;
