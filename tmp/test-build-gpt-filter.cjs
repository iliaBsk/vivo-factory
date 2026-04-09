const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const code = fs.readFileSync('tmp/build-gpt-before.js', 'utf8');

const mockItems = [
  {
    json: {
      classification: { category: 'technology', is_deal: false },
      user_profile: {},
      protagonist: {
        description: 'blonde woman',
        gender: 'female',
        hair_color: 'blonde',
        skin_tone: 'light'
      },
      story: {
        title: 'VC winter startups',
        text: 'A ranking of YC winter startups.'
      },
      images_results: [
        {
          original:
            'https://www.tiktok.com/api/img/?itemId=7590187680760188174&location=0&aid=1988',
          thumbnail:
            'https://p16-sign-va.tiktokcdn.com/obj/tos-maliva-p-0068/example.jpeg',
          title: 'TikTok result',
          source: 'TikTok',
          position: 1
        },
        {
          original: 'https://images.example.com/editorial/photo-1.jpg',
          thumbnail: 'https://images.example.com/editorial/thumb-1.jpg',
          title: 'Editorial result',
          source: 'Example News',
          position: 2
        }
      ]
    }
  }
];

const context = {
  $input: {
    all: () => mockItems
  },
  console
};

const wrapped = `(function(){${code}\n})();`;
const result = vm.runInNewContext(wrapped, context, { timeout: 1000 });
const body = result[0].json.body;
const inputImages = body.input[0].content
  .filter((part) => part.type === 'input_image')
  .map((part) => part.image_url);

assert.equal(
  inputImages.some((url) => /tiktok/i.test(url)),
  false,
  `TikTok URL leaked into GPT request: ${inputImages.join(', ')}`
);

console.log('ok');
