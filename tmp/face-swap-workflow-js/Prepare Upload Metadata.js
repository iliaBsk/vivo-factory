(function(){
const item = $input.first();
const json = item.json || {};
const binary = item.binary || {};
const file = binary.data || {};

const extension = file.fileExtension ? `.${file.fileExtension}` : '';
const fileName = `${json.asset_slot}-faceswap-${json.asset_id}${extension}`;

return [{
  json: {
    ...json,
    file_name: fileName,
    object_path: fileName,
    mime_type: file.mimeType || 'application/octet-stream'
  },
  binary
}];
})();
