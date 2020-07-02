const
    fs = require('fs').promises,
    fsconstants = require('fs').constants;

class BuildAnnotations {
    constructor(conanserverroot) {
        this.conanserverroot = conanserverroot;
    }

    getAnnotationsFilepath(library, version, buildhash) {
        return `${this.conanserverroot}/data/${library}/${version}/${library}/${version}/0/package/${buildhash}/annotations.json`;
    }
    
    async writeAnnotations(library, version, buildhash, annotations) {
        return fs.writeFile(this.getAnnotationsFilepath(library, version, buildhash), JSON.stringify(annotations), 'utf8');
    }
    
    async readAnnotations(library, version, buildhash) {
        const filepath = this.getAnnotationsFilepath(library, version, buildhash);
        try {
            await fs.access(filepath, fsconstants.R_OK | fsconstants.W_OK);
    
            const data = await fs.readFile(filepath, 'utf8');
            return JSON.parse(data);
        } catch(e) {
            return {};
        }
    }
}

module.exports = {
    BuildAnnotations
};
