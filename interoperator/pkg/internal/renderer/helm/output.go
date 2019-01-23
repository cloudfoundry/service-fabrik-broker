package helm

import (
	"fmt"
	"path/filepath"
)

type helmOutput struct {
	Name  string
	Files map[string]string
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
