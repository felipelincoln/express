const fs = require('fs');
const path = require('path');

const input = './metadata/';
const output = './metadata.json';
const output2 = './allAttributes.json';

let result = {};
let allAttributes = {};

fs.readdirSync(input).forEach(filename => {
    if (filename.endsWith('.json')) {
        const filePath = path.join(input, filename);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        const tokenId = filename.replace('.json', '');
        const attributes = {};

        for(const attribute of data.attributes){
            const traitType = attribute["trait_type"];
            const value = attribute["value"];

            if(!allAttributes[traitType]){
                allAttributes[traitType] = new Set();
            } else {
                allAttributes[traitType].add(value);
            }

            attributes[traitType] = value;
        }

        result[tokenId] = attributes;
    }
});

for(const attribute of Object.keys(allAttributes)){
    allAttributes[attribute] = Array.from(allAttributes[attribute]);
}

fs.writeFileSync(output, JSON.stringify(result, null, 2));
fs.writeFileSync(output2, JSON.stringify(allAttributes, null, 2));
console.log(`Combined data saved to: ${output}`);
console.log(`All attributes data saved to: ${output2}`);
