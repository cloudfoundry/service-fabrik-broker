# Service Fabrik Documentation

Source files for all Service Fabrik relevant documentation.

### Prerequisites

* `build-essentials` for compiling further packages
* `python-sphinx` for building the python library documentation
On Mac:
- Install macports and then install [python-sphinx](http://www.sphinx-doc.org/en/stable/install.html#mac-os-x-install-sphinx-using-macports)
- Install Pip (sudo easy_install pip)
- Install Pillow (sudo pip install pillow)
- Install seqdiag (sudo easy_install seqdiag)
At times you might have to upgrade setup tools (pip install setuptools --upgrade)
[Learn Seqdiag - http://blockdiag.com/en/seqdiag/examples.html]

NPM packages:
* `aglio` for building the API documentation (npm install -g aglio)
* `marked, highlight.js` for rendering Markdown to HTML

### Build the documentation

```shell
$ npm install
$ bash bin/build.sh
```
