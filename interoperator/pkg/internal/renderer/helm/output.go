package helm

import (
	"bytes"
	"fmt"
	"path/filepath"
)

type helmOutput struct {
	Name  string
	Files map[string]string
}

// Manifest returns the manifest of the rendered chart as byte array.
func (c *helmOutput) Manifest() ([]byte, error) {
	// Aggregate all valid manifests into one big doc.
	b := bytes.NewBuffer(nil)

	for k, v := range c.Files {
		b.WriteString("\n---\n# Source: " + k + "\n")
		b.WriteString(v)
	}
	return b.Bytes(), nil
}

// ManifestAsString returns the manifest of the rendered chart as string.
func (c *helmOutput) ManifestAsString() (string, error) {
	manifest, err := c.Manifest()
	return string(manifest), err
}

// FileContent returns explicitly the content of the provided <filename>.
func (c *helmOutput) FileContent(filename string) (string, error) {
	contentString, ok := c.Files[fmt.Sprintf("%s/templates/%s", c.Name, filename)]
	if !ok {
		return "", fmt.Errorf("file %s not found in rendered helm chart output", filename)
	}
	return contentString, nil
}

// ListFiles returns list of file names rendered
func (c *helmOutput) ListFiles() ([]string, error) {
	fileNames := make([]string, 0, len(c.Files))
	for k := range c.Files {
		fileNames = append(fileNames, filepath.Base(k))
	}
	return fileNames, nil
}
