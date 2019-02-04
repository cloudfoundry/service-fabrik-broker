default: toc

spell:
	@cat architecture/basic.md | aspell -l en_US -a | tee bin/architecture/basic.spell \
	@cat architecture/cluster-landscape.md | aspell -l en_US -a | tee bin/architecture/cluster-landscape.spell
	@cat architecture/cluster-landscape-autoscaling.md | aspell -l en_US -a | tee bin/architecture/cluster-landscape-autoscaling.spell

toc:
	@cat architecture/basic.md | gh-md-toc 
	@cat architecture/cluster-landscape.md | gh-md-toc 
	@cat architecture/cluster-landscape-autoscaling.md | gh-md-toc 