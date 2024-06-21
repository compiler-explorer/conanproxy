const
    fs = require('fs').promises,
    fsconstants = require('fs').constants,
    ini = require('ini');

class BuildAnnotations {
    constructor(conanserverroot) {
        this.conanserverroot = conanserverroot;
    }

    getPackageRootPath(library, version) {
        return `${this.conanserverroot}/data/${library}/${version}/${library}/${version}/0/package`;
    }

    getConanInfoFilepath(library, version, buildhash) {
        return `${this.conanserverroot}/data/${library}/${version}/${library}/${version}/0/package/${buildhash}/0/conaninfo.txt`;
    }

    getConanManifestFilepath(library, version, buildhash) {
        return `${this.conanserverroot}/data/${library}/${version}/${library}/${version}/0/package/${buildhash}/0/conanmanifest.txt`;
    }

    getAnnotationsFilepath(library, version, buildhash) {
        return `${this.conanserverroot}/data/${library}/${version}/${library}/${version}/0/package/${buildhash}/annotations.json`;
    }
    
    async writeAnnotations(library, version, buildhash, annotations) {
        return fs.writeFile(this.getAnnotationsFilepath(library, version, buildhash), JSON.stringify(annotations), 'utf8');
    }
    
    async readAnnotationFromFile(filepath) {
        try {
            await fs.access(filepath, fsconstants.R_OK | fsconstants.W_OK);
    
            const data = await fs.readFile(filepath, 'utf8');
            return JSON.parse(data);
        } catch(e) {
            return {error: e.message};
        }
    }

    async readAnnotations(library, version, buildhash) {
        const filepath = this.getAnnotationsFilepath(library, version, buildhash);
        return await this.readAnnotationFromFile(filepath);
    }

    async readConanInfoFromFile(filepath) {
        try {
            await fs.access(filepath, fsconstants.R_OK | fsconstants.W_OK);

            const data = await fs.readFile(filepath, 'utf8');

            const content = ini.parse(data);

            return {
                arch: content.settings['arch'],
                compilerId: content.settings['compiler.version'],
                compilerType: content.settings['compiler'],
                libcxx: content.settings['compiler.libcxx'],
                os: content.settings['os']
            };
        } catch (e) {
            return {
                error: e.message,
            };
        }
    }

    async readAllAnnotations(library, version) {
        const rootpath = this.getPackageRootPath(library, version);

        const allAnnotations = [];

        const dir = await fs.opendir(rootpath);
        for await (const dirent of dir) {
            if (dirent.isDirectory()) {
                const buildhash = dirent.name;

                const annotationFilepath = this.getAnnotationsFilepath(library, version, buildhash);
                const infoFilepath = this.getConanInfoFilepath(library, version, buildhash);

                const details = {
                    buildhash: buildhash,
                    buildInfo: await this.readAnnotationFromFile(annotationFilepath),
                    compilerInfo: await this.readConanInfoFromFile(infoFilepath),
                };

                allAnnotations.push(details);
            }
        }

        return allAnnotations;
    }
}

module.exports = {
    BuildAnnotations
};
